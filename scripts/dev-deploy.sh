#!/usr/bin/env bash
# Deploy this working tree straight to the dev stage from your machine, skipping GitHub Actions.
#
#   pnpm dev:deploy          backend (CDK) and site
#   pnpm dev:deploy api      backend only: Lambda code hotswaps in seconds, anything else
#                            (IAM, env, new routes) falls back to a normal CloudFormation deploy
#   pnpm dev:deploy web      site only: build against dev's stack outputs, sync to S3, invalidate
#
# Dev only; prod goes through the GitHub "Deploy" workflow, which is manual-only while the
# site is in development (merging to main no longer deploys).
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=dev
PROFILE=fgg
export AWS_REGION=us-east-1
what="${1:-all}"
case "$what" in
  all | api | web) ;;
  *)
    echo "usage: pnpm dev:deploy [all|api|web]" >&2
    exit 1
    ;;
esac

aws sts get-caller-identity --profile "$PROFILE" --query Account --output text >/dev/null ||
  { echo "AWS profile '$PROFILE' is not signed in." >&2; exit 1; }

dirty=""
[ -n "$(git status --porcelain)" ] && dirty=" + uncommitted changes"
echo "▶ Deploying $(git rev-parse --abbrev-ref HEAD)@$(git rev-parse --short HEAD)$dirty to $STAGE ($what)"
start=$SECONDS

if [ "$what" != web ]; then
  echo "▶ Backend"
  pnpm turbo run build --filter=@fgg/infra... --output-logs=errors-only
  (
    cd infra
    pnpm cdk deploy --all -c stage="$STAGE" --profile "$PROFILE" \
      --require-approval never --hotswap-fallback --outputs-file "outputs.$STAGE.json"
  )
fi

if [ "$what" != api ]; then
  echo "▶ Site"
  out() {
    aws cloudformation describe-stacks --profile "$PROFILE" --stack-name "Fgg-$STAGE-$1" \
      --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
  }
  export NEXT_PUBLIC_STAGE="$STAGE"
  NEXT_PUBLIC_API_URL="$(out Api ApiUrl)"
  NEXT_PUBLIC_MEDIA_URL="$(out Media MediaBaseUrl)"
  NEXT_PUBLIC_COGNITO_USER_POOL_ID="$(out Auth UserPoolId)"
  NEXT_PUBLIC_COGNITO_CLIENT_ID="$(out Auth UserPoolClientId)"
  NEXT_PUBLIC_COGNITO_DOMAIN="$(out Auth UserPoolDomain)"
  NEXT_PUBLIC_SITE_URL="$(out Web WebUrl)"
  export NEXT_PUBLIC_API_URL NEXT_PUBLIC_MEDIA_URL NEXT_PUBLIC_COGNITO_USER_POOL_ID \
    NEXT_PUBLIC_COGNITO_CLIENT_ID NEXT_PUBLIC_COGNITO_DOMAIN NEXT_PUBLIC_SITE_URL
  bucket="$(out Web WebBucketName)"
  distribution="$(out Web WebDistributionId)"

  pnpm turbo run build --filter=@fgg/web... --output-logs=errors-only
  # Same cache headers as the GitHub web deploy: hashed assets are immutable, pages revalidate.
  aws s3 sync apps/web/out "s3://$bucket" --profile "$PROFILE" --delete --only-show-errors \
    --exclude "_next/static/*" --cache-control "public, max-age=0, must-revalidate"
  aws s3 sync apps/web/out/_next/static "s3://$bucket/_next/static" --profile "$PROFILE" \
    --delete --only-show-errors --cache-control "public, max-age=31536000, immutable"
  aws cloudfront create-invalidation --profile "$PROFILE" --distribution-id "$distribution" \
    --paths "/*" --query Invalidation.Id --output text >/dev/null
  echo "  published $NEXT_PUBLIC_SITE_URL (CloudFront refreshes within a minute or two)"
fi

echo "✔ Done in $((SECONDS - start))s"
