const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatExpirationDate,
  calculateExpirationComment,
  generateVoucher,
  PLANS,
  TIMEZONE,
} = require('../server');

/**
 * Emulates the RouterOS v7 scheduler expiration logic from hotspot/scheduler.md:
 * :local date [ /system clock get date ];
 * :local time [ /system clock get time ];
 * :local today [:tonum ([:pick $date 0 4] . [:pick $date 5 7] . [:pick $date 8 10])];
 * :local curtime (([:tonum [:pick $time 0 2]] * 3600) + ([:tonum [:pick $time 3 5]] * 60) + [:tonum [:pick $time 6 8]]);
 * :if ([:len $comment] >= 19 and [:pick $comment 4] = "-" and [:pick $comment 7] = "-") do={
 *   :local expd [:tonum ([:pick $comment 0 4] . [:pick $comment 5 7] . [:pick $comment 8 10])];
 *   :local expt (([:tonum [:pick $comment 11 13]] * 3600) + ([:tonum [:pick $comment 14 16]] * 60) + [:tonum [:pick $comment 17 19]]);
 *   :if (($expd < $today) or ($expd = $today and $expt <= $curtime)) do={ ... expired ... }
 * }
 */
function emulateRouterOsScheduler(comment, routerDateStr, routerTimeStr) {
  const today = Number(
    routerDateStr.slice(0, 4) + routerDateStr.slice(5, 7) + routerDateStr.slice(8, 10)
  );
  const curtime =
    Number(routerTimeStr.slice(0, 2)) * 3600 +
    Number(routerTimeStr.slice(3, 5)) * 60 +
    Number(routerTimeStr.slice(6, 8));

  // RouterOS :if check
  if (comment.length >= 19 && comment[4] === '-' && comment[7] === '-') {
    const expd = Number(
      comment.slice(0, 4) + comment.slice(5, 7) + comment.slice(8, 10)
    );
    const expt =
      Number(comment.slice(11, 13)) * 3600 +
      Number(comment.slice(14, 16)) * 60 +
      Number(comment.slice(17, 19));

    const isExpired = expd < today || (expd === today && expt <= curtime);
    return {
      accepted: true,
      expired: isExpired,
      expd,
      expt,
      today,
      curtime,
    };
  }

  return { accepted: false, reason: 'Rejected by RouterOS :if check' };
}

describe('MikroTik Scheduler Comment Formatting', () => {
  test('Comment conforms to YYYY-MM-DD HH:MM:SS format', () => {
    const sampleDate = new Date('2026-10-02T10:00:00.000Z');
    const comment = formatExpirationDate(sampleDate, 'UTC');

    assert.equal(comment.length, 19);
    assert.match(comment, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(comment[4], '-');
    assert.equal(comment[7], '-');
    assert.equal(comment[10], ' ');
    assert.equal(comment[13], ':');
    assert.equal(comment[16], ':');
  });

  test('DailySub calculates exactly 20 hours validity', () => {
    const baseDate = new Date('2026-10-02T09:31:27.000Z');
    const comment = calculateExpirationComment('DailySub', baseDate, 'UTC');

    // 20 hours after 09:31:27 is next day at 05:31:27
    assert.equal(comment, '2026-10-03 05:31:27');

    // Verify it passes RouterOS scheduler simulation
    const resNow = emulateRouterOsScheduler(comment, '2026-10-02', '09:31:27');
    assert.equal(resNow.accepted, true);
    assert.equal(resNow.expired, false, 'Should be active immediately after creation');

    // 1 second before expiry: still active
    const resBefore = emulateRouterOsScheduler(comment, '2026-10-03', '05:31:26');
    assert.equal(resBefore.expired, false);

    // Exact expiry moment: expired
    const resExact = emulateRouterOsScheduler(comment, '2026-10-03', '05:31:27');
    assert.equal(resExact.expired, true);

    // 1 hour after expiry: expired
    const resAfter = emulateRouterOsScheduler(comment, '2026-10-03', '06:31:27');
    assert.equal(resAfter.expired, true);
  });

  test('WeeklySub calculates exactly 7 days (168 hours) validity', () => {
    const baseDate = new Date('2026-10-02T09:33:07.000Z');
    const comment = calculateExpirationComment('WeeklySub', baseDate, 'UTC');

    // 7 days after Oct 02 is Oct 09 at 09:33:07
    assert.equal(comment, '2026-10-09 09:33:07');

    const res = emulateRouterOsScheduler(comment, '2026-10-02', '10:00:00');
    assert.equal(res.accepted, true);
    assert.equal(res.expired, false);

    const resExpired = emulateRouterOsScheduler(comment, '2026-10-09', '09:33:08');
    assert.equal(resExpired.expired, true);
  });

  test('MonthlySub calculates exactly 30 days (720 hours) validity', () => {
    const baseDate = new Date('2026-10-02T09:34:54.000Z');
    const comment = calculateExpirationComment('MonthlySub', baseDate, 'UTC');

    // 30 days after Oct 02 is Nov 01 at 09:34:54
    assert.equal(comment, '2026-11-01 09:34:54');

    const res = emulateRouterOsScheduler(comment, '2026-10-02', '12:00:00');
    assert.equal(res.accepted, true);
    assert.equal(res.expired, false);

    const resExpired = emulateRouterOsScheduler(comment, '2026-11-01', '09:35:00');
    assert.equal(resExpired.expired, true);
  });

  test('Rejects comments with vc- prefix or invalid formats', () => {
    // If prefixed with vc-, RouterOS rejects it because index 4 is not '-'
    const vcPrefixed = 'vc-2026-10-03 05:31:27';
    const resVc = emulateRouterOsScheduler(vcPrefixed, '2026-10-02', '12:00:00');
    assert.equal(resVc.accepted, false);

    // Old comment format: 'vc-DailySub'
    const oldFormat = 'vc-DailySub';
    const resOld = emulateRouterOsScheduler(oldFormat, '2026-10-02', '12:00:00');
    assert.equal(resOld.accepted, false);
  });

  test('Month and year boundary rollovers are handled properly', () => {
    // New Year rollover
    const dec31 = new Date('2026-12-31T20:00:00.000Z');
    const comment = calculateExpirationComment('DailySub', dec31, 'UTC');
    assert.equal(comment, '2027-01-01 16:00:00');

    const res = emulateRouterOsScheduler(comment, '2026-12-31', '21:00:00');
    assert.equal(res.accepted, true);
    assert.equal(res.expired, false);

    const resNextYear = emulateRouterOsScheduler(comment, '2027-01-01', '16:00:01');
    assert.equal(resNextYear.expired, true);
  });
});

describe('Voucher Generation', () => {
  test('Generates valid 8-character voucher with hyphen (XXXX-XXXX)', () => {
    for (let i = 0; i < 50; i++) {
      const voucher = generateVoucher();
      assert.equal(voucher.length, 9);
      assert.equal(voucher[4], '-');
      // No ambiguous chars (0, O, 1, I)
      assert.doesNotMatch(voucher, /[0O1I]/);
      assert.match(voucher, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });
});
