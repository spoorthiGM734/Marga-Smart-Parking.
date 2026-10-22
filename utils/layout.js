// Geometry-based digital layout generator.
// Pattern along the site length: slots | aisle | slots  slots | aisle | slots ...
// (rows back-to-back, every row faces a driving aisle). Operators can review/move/remove afterwards.
const VEHICLES = {
  car: { w: 2.5, d: 5.0 },
  suv: { w: 2.7, d: 5.5 },
  bike: { w: 1.0, d: 2.0 },
};
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function generateLayout({ width, length, vehicle = 'car', aisle = 6, margin = 1, obstacles = [], maxSlots = 0, startNumber = 1 }) {
  const v = VEHICLES[vehicle];
  if (!v) throw new Error('Unknown vehicle type');
  width = Number(width); length = Number(length);
  if (!(width >= 5 && length >= 5)) throw new Error('Site width and length must be at least 5 m');
  aisle = Math.max(Number(aisle) || 6, vehicle === 'bike' ? 3 : 5.5); // minimum manoeuvring aisle
  const cols = Math.floor((width - 2 * margin) / v.w);
  if (cols < 1 || length - 2 * margin < v.d) throw new Error('Site is too small for this vehicle type');

  const limit = maxSlots > 0 ? maxSlots : Infinity;
  const pattern = ['S', 'A', 'S'];
  const slots = [];
  let y = margin, i = 0, n = Number(startNumber) || 1;

  while (slots.length < limit) {
    const t = pattern[i % 3];
    const h = t === 'S' ? v.d : aisle;
    if (y + h > length - margin + 1e-9) break;
    if (t === 'S') {
      for (let c = 0; c < cols && slots.length < limit; c++) {
        const r = { x: +(margin + c * v.w).toFixed(2), y: +y.toFixed(2), w: v.w, h: v.d };
        if (obstacles.some((o) => hit(r, o))) continue; // skip spaces blocked by pillars, trees, etc.
        slots.push({ ...r, label: 'Slot ' + n++, vehicle_type: vehicle });
      }
    }
    y += h; i++;
  }
  if (!slots.length) throw new Error('No valid parking spaces fit in this site');
  return slots;
}
module.exports = { generateLayout, VEHICLES };
