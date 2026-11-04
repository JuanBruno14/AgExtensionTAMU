/* Shared market-price store (localStorage key "tamuDecisionAidsMarketPrices").

   Since 2026-11-04 the store holds only the numbers a visitor typed on the home page's
   "Market prices & factors" calculator (marked v:2). Every other price falls back to each
   page's built-in default, which the weekly USDA price job keeps current.

   Copies saved before that (no "v") held every value, defaults included, so returning
   visitors stayed on old prices after the defaults moved. This script runs before each
   page's own code and drops any saved value that equals a past default, keeping the ones
   the visitor really changed. Past defaults: git history of index.html (MP_DEFAULTS). */
(function(){
  var KEY = 'tamuDecisionAidsMarketPrices';
  var PAST = {
    mp_steerPrice:[530], mp_heiferPrice:[460], mp_cullCowPrice:[180], mp_cullBullPrice:[190],
    mp_stocker700Price:[380], mp_stocker800Price:[360], mp_bredCowPrice:[2828.62],
    mp_bredHeiferPrice:[3884.78, 3625], mp_fedCattlePrice:[222.82, 220.11],
    mp_bullCost:[4500], mp_bullLife:[4], mp_bullSalvageWeight:[1650.7], mp_bullDeathLoss:[2], mp_perBull:[25],
    mp_hayPrice:[210], mp_hayRollLb:[1000]
  };
  try {
    var raw = window.localStorage.getItem(KEY);
    if(!raw) return;
    var d = JSON.parse(raw);
    if(!d || typeof d !== 'object' || d.v >= 2) return;
    Object.keys(PAST).forEach(function(k){
      if(k in d && PAST[k].some(function(x){ return Math.abs(+d[k] - x) < 1e-6; })) delete d[k];
    });
    d.v = 2;
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch(e){ /* private mode / blocked storage: nothing saved, nothing to clean */ }
})();
