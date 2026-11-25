// Virtual Fence Collars vs. the Beef_Cattle_Collars_Texas workbook (one-year view).
//   node tools/test_collars.js
// With the savings left empty, as in the workbook, the model must give the workbook's own results.
const path = require('path');
const { calc, DEFAULTS, VENDORS, vendorById } = require(path.join(__dirname, '..', 'new-technologies', 'collars.js'));
let fails = 0;
function check(name, got, want, tol) {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= (tol || 0.005) : got === want;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' — got ' + got + ', want ' + want));
  if (!ok) fails++;
}

// Workbook as saved: savings row empty. C8 = 264, C21 = 26,685, C22 = 42,885, C63 = -26,685, C64 = -88.95, C67 = 25.2699, C68 = -5.714
const empty = Object.assign({}, DEFAULTS, { hours: 0, trips: 0, buildMiles: 0, maintMiles: 0 });
let r = calc(empty);
check('calves sold (C8)', r.calves, 264);
check('collars needed (315)', r.collars, 315);
check('towers (4)', r.towers, 4);
check('average cost per year (C21)', r.cost.total, 26685);
check('cash in year 1 (C22)', r.cash1, 42885);
check('net per year (C63)', r.net, -26685);
check('per cow (C64)', r.perCow, -88.95);
check('answer (C65)', r.pays, false);
check('extra weaning weight to break even (C67)', r.beWeight, 25.269886363636363, 1e-6);
check('highest fee that breaks even (C68)', r.beFee, -5.714285714285708, 1e-6);

// Workbook inputs and notes: 240 h x $18, 80 trips x $17.50, 8 mi upkeep at 2% of $15,600, 4 mi x $15,600 / 30 yr.
r = calc(DEFAULTS);
check('labor saved', r.sav.labor, 4320);
check('trips saved', r.sav.trips, 1400);
check('fence upkeep saved (8 x 15,600 x 2%)', r.sav.maint, 2496);
check('fence not built (H37)', r.sav.build, 2080);
check('total savings', r.benefit, 10296);
check('net per year', r.net, 10296 - 26685);
check('highest fee that breaks even', r.beFee, 79 + (10296 - 26685) / 315, 1e-6);
check('extra weight to break even', r.beWeight, 16389 / (264 * 400 / 100), 1e-6);

// Extra weaning weight: 25.27 lb per calf makes the workbook result zero (C47 = lb x calves x $/cwt / 100).
r = calc(Object.assign({}, empty, { gain: 25.269886363636363 }));
check('extra weaning income (C47) offsets the cost', r.net, 0, 1e-6);

// Other vendors: collar bought up front and spread over 7 years; towers only when the vendor needs them.
const nof = vendorById('nofence');
r = calc(Object.assign({}, empty, { vendor: 'nofence', collarPrice: nof.collarPrice, fee: nof.fee, towerPrice: 0, towers: null }));
check('Nofence: no towers', r.towers, 0);
check('Nofence: yearly cost', r.cost.total, 315 * 319 / 7 + 315 * 40);
check('Nofence: cash in year 1 (fee included in collar price)', r.cash1, 315 * 319);
const sat = vendorById('halter-sat');
r = calc(Object.assign({}, empty, { vendor: 'halter-sat', fee: sat.fee, towerPrice: 0, towers: null }));
check('Halter satellite: yearly cost', r.cost.total, 315 * 96);
check('Halter satellite: cash in year 1', r.cash1, 315 * 96);

// Inputs that cannot divide by zero.
r = calc(Object.assign({}, DEFAULTS, { cows: 0, bulls: 0, acres: 0, price: 0, collarLife: 0, towerLife: 0, fenceLife: 0 }));
check('zero herd does not break the numbers', Number.isFinite(r.net) && Number.isFinite(r.perCow) && Number.isFinite(r.beWeight), true);
check('every vendor is listed once', new Set(VENDORS.map(v => v.id)).size, VENDORS.length);

console.log(fails ? '\n' + fails + ' failure(s)' : '\nAll checks passed');
process.exit(fails ? 1 : 0);
