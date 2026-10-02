#!/usr/bin/env bash
# Mint a Cognito ID token for a user via the IAM-gated ADMIN_USER_PASSWORD_AUTH flow.
# Ops/testing only. Usage: AWS_PROFILE=fgg infra/scripts/dev-token.sh <stage> <email> <password>
set -euo pipefail
stage=${1:?stage}; email=${2:?email}; password=${3:?password}
pool=$(aws cloudformation describe-stacks --stack-name "Fgg-$stage-Auth" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
client=$(aws cloudformation describe-stacks --stack-name "Fgg-$stage-Auth" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
aws cognito-idp admin-initiate-auth --user-pool-id "$pool" --client-id "$client" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$email,PASSWORD=$password" \
  --query 'AuthenticationResult.IdToken' --output text
