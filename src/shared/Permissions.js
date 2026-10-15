/**
 * Permissions — single source of truth for role checks. Every server API calls
 * Permissions.assert(user, action, ctx) before reading or writing data.
 */
var Permissions = (function () {
  'use strict';

  var ROLES = {
    ADMIN: { name_th: 'ผู้ดูแลระบบ (Admin)' },
    AUDITOR: { name_th: 'ผู้ตรวจ (Auditor)' },
    WORKSHOP_OWNER: { name_th: 'เจ้าของหน่วยงาน (Workshop Owner)' },
    VIEWER: { name_th: 'ผู้ดูรายงาน (Viewer)' }
  };

  function inScope(user, workshopId) {
    var s = user && user.scope_workshop_ids;
    if (!s) return false;
    if (s.indexOf('*') >= 0) return true;
    return workshopId != null && s.indexOf(workshopId) >= 0;
  }

  /**
   * @param {{id:string, role:string, scope_workshop_ids:string[], active:boolean}} user
   * @param {string} action
   * @param {Object=} ctx {workshop_id, audit_status, linked_to_finding, phase, submitted_by}
   */
  function can(user, action, ctx) {
    ctx = ctx || {};
    if (!user || user.active === false) return false;
    var r = user.role;
    var admin = r === 'ADMIN';
    var auditor = r === 'AUDITOR';
    var owner = r === 'WORKSHOP_OWNER';
    var viewer = r === 'VIEWER';
    var scoped = admin || inScope(user, ctx.workshop_id);
    var confirmed = ctx.audit_status === 'CONFIRMED';
    switch (action) {
      case 'standard.manage': case 'user.manage': case 'settings.manage': case 'exemption.approve': case 'master.manage':
        return admin;
      case 'standard.view': case 'dashboard.view':
        return admin || auditor || owner || viewer;
      case 'audit.create':
        return admin || (auditor && scoped);
      case 'audit.view':
        if (admin) return true;
        if (!scoped) return false;
        return auditor || ((owner || viewer) && confirmed);
      case 'audit.edit': case 'ai.run': case 'redline.confirm': case 'score.override': case 'exemption.request':
        return !confirmed && ctx.audit_status !== 'CANCELLED' && (admin || (auditor && scoped));
      case 'audit.confirm':
        return !confirmed && (admin || (auditor && scoped));
      case 'evidence.view':
        if (admin) return true;
        if (!scoped) return false;
        return auditor || (owner && !!ctx.linked_to_finding);
      case 'evidence.upload':
        if (ctx.phase === 'AFTER_FIX') return admin || (scoped && (auditor || owner));
        return can(user, 'audit.edit', ctx);
      case 'finding.view':
        if (admin) return true;
        return scoped && (auditor || owner || (viewer && confirmed));
      case 'finding.update':
        return admin || (auditor && scoped);
      case 'finding.submit_action':
        return admin || (scoped && (auditor || owner));
      case 'finding.verify':
        return (admin || (auditor && scoped)) && ctx.submitted_by !== user.id;
      case 'report.export':
        return admin || (scoped && (auditor || ((owner || viewer) && confirmed)));
      default:
        return false;
    }
  }

  function assert(user, action, ctx) {
    if (!can(user, action, ctx)) {
      var e = new Error('ไม่มีสิทธิ์ดำเนินการนี้ (' + action + ')');
      e.code = 'FORBIDDEN';
      throw e;
    }
  }

  return { ROLES: ROLES, can: can, assert: assert, inScope: inScope };
})();
