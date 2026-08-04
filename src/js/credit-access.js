'use strict';

const MesssCredits = (() => {
  function availableBalance(snapshot) {
    const balance = Number(snapshot && snapshot.credits && snapshot.credits.balance);
    const reserved = Number(snapshot && snapshot.credits && snapshot.credits.reserved);
    return Math.max(0, (Number.isFinite(balance) ? balance : 0) - (Number.isFinite(reserved) ? reserved : 0));
  }

  function publish(snapshot) {
    if (!snapshot) return;
    document.dispatchEvent(new CustomEvent('messs:membership-updated', { detail: snapshot }));
  }

  async function quote(request = {}) {
    const [pricing, membership] = await Promise.all([
      window.messsAPI.quoteMediaCredits(request),
      window.messsAPI.getMembershipSnapshot()
    ]);
    const requiredCredits = Math.max(0, Math.ceil(Number(pricing && pricing.totalCredits) || 0));
    const availableCredits = availableBalance(membership);
    publish(membership);
    return {
      ok: requiredCredits > 0 && availableCredits >= requiredCredits,
      requiredCredits,
      availableCredits,
      pricing,
      membership
    };
  }

  async function ensure(request = {}, options = {}) {
    let access;
    try {
      access = await quote(request);
    } catch (error) {
      // The main process performs the authoritative check. If this optional
      // renderer preflight fails, allow it to make the final decision.
      return { ok: true, preflightUnavailable: true };
    }
    if (!access.ok && options.notify !== false && typeof showToast === 'function') {
      showToast(
        typeof t === 'function'
          ? t(
            `Not enough points. This request needs ${access.requiredCredits}; ${access.availableCredits} are available.`,
            `积分不足：本次需要 ${access.requiredCredits} 积分，当前可用 ${access.availableCredits} 积分。`
          )
          : `Not enough points. This request needs ${access.requiredCredits}; ${access.availableCredits} are available.`,
        'AI'
      );
    }
    return access;
  }

  return { availableBalance, publish, quote, ensure };
})();

window.MesssCredits = MesssCredits;
if (window.messsAPI && typeof window.messsAPI.onMembershipUpdated === 'function') {
  window.messsAPI.onMembershipUpdated((snapshot) => MesssCredits.publish(snapshot));
}
