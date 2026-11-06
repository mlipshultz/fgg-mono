import { vi } from 'vitest';

// The fixture shows run on 2026-10-24/25. Start every test file a few weeks earlier, with the
// clock still ticking (holds expire, ULIDs stay ordered); only Date is faked, timers stay real.
vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
