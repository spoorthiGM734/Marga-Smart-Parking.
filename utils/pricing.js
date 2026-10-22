// Fee = grace period -> hourly rate (rounded up to the next hour) -> minimum charge -> daily cap
function calcFee(minutes, t) {
  if (minutes <= (t.grace_minutes || 0)) return 0;
  const DAY = 1440;
  const fullDays = Math.floor(minutes / DAY);
  const rem = minutes - fullDays * DAY;
  const part = (m) => (m <= 0 ? 0 : Math.max(t.min_charge || 0, Math.ceil(m / 60) * t.hourly_rate));
  let remFee = part(rem);
  if (t.daily_cap) remFee = Math.min(remFee, t.daily_cap);
  const dayFee = t.daily_cap || 24 * t.hourly_rate;
  return Math.round((fullDays * dayFee + remFee) * 100) / 100;
}
module.exports = { calcFee };
