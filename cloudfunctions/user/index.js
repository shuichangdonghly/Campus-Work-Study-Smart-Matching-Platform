const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

async function ensureCollection(name) {
  // 有些情况下集合不会自动创建，这里做一次兜底
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合可能已存在或创建失败（后续逻辑会兜底报错）
    console.error('ensureCollection createCollection failed:', name, e && (e.errMsg || e.message || e));
  }
}

async function getUserByOpenid(openid) {
  const r = await db.collection('users').where({ openid }).get();
  return r.data[0] || null;
}

function asPositiveInt(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return n;
}

function assertAdmin(user) {
  if (!user || (user.role !== 'admin' && !user.isAdmin)) {
    return { ok: false, err: { code: 403, message: '需要管理员权限' } };
  }
  return { ok: true };
}

function pickRoleVerify(user, role) {
  if (role === 'student') {
    return {
      status: user.studentVerifyStatus || (user.role === 'student' ? user.verifyStatus : 'none') || 'none',
      payload: user.studentVerifyPayload || (user.role === 'student' ? user.verifyPayload : {}) || {}
    };
  }
  return {
    status: user.publisherVerifyStatus || (user.role === 'publisher' ? user.verifyStatus : 'none') || 'none',
    payload: user.publisherVerifyPayload || (user.role === 'publisher' ? user.verifyPayload : {}) || {}
  };
}

function cleanText(value, maxLength) {
  const str = String(value == null ? '' : value).trim();
  if (!maxLength || maxLength <= 0) return str;
  return str.slice(0, maxLength);
}

function resolveDisplayName(user) {
  if (!user) return '用户';
  const studentPayload = user.studentVerifyPayload || {};
  const publisherPayload = user.publisherVerifyPayload || {};
  const currentPayload = user.verifyPayload || {};
  return (
    studentPayload.realName ||
    publisherPayload.unitName ||
    currentPayload.realName ||
    currentPayload.unitName ||
    user.nickName ||
    '用户'
  );
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  if (!OPENID) {
    return { code: 1, message: '未登录' };
  }

  await ensureCollection('users');
  await ensureCollection('wallet_logs');

  const me = await getUserByOpenid(OPENID);
  if (!me) {
    return { code: 2, message: '用户不存在，请先微信登录' };
  }

  try {
    if (action === 'getProfile') {
      return { code: 0, user: me };
    }

    if (action === 'getPublicProfile') {
      const targetOpenid = String(event.targetOpenid || '').trim();
      if (!targetOpenid) return { code: 400, message: '缺少 targetOpenid' };
      const target = await getUserByOpenid(targetOpenid);
      if (!target) return { code: 404, message: '用户不存在' };
      return {
        code: 0,
        profile: {
          openid: target.openid,
          role: target.role || '',
          nickName: target.nickName || '',
          avatarUrl: target.avatarUrl || '',
          displayName: resolveDisplayName(target),
          studentVerifyPayload: target.studentVerifyPayload || {},
          publisherVerifyPayload: target.publisherVerifyPayload || {}
        }
      };
    }

    if (action === 'updateProfile') {
      const payload = event.payload || {};
      const nickName = cleanText(payload.nickName, 30);
      const avatarUrl = cleanText(payload.avatarUrl, 500);
      const profileBio = cleanText(payload.profileBio, 120);
      if (!nickName) {
        return { code: 400, message: '昵称不能为空' };
      }
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          nickName,
          avatarUrl,
          profileBio,
          updateTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u };
    }

    if (action === 'recharge') {
      const amount = asPositiveInt(event.amount);
      if (!amount) return { code: 400, message: '充值金额需为正整数' };
      if (amount > 100000) return { code: 400, message: '单次充值金额过大' };
      const beforeBalance = parseInt(me.pointsBalance || 0, 10) || 0;
      const afterBalance = beforeBalance + amount;
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          pointsBalance: _.inc(amount),
          updateTime: db.serverDate()
        }
      });
      await db.collection('wallet_logs').add({
        data: {
          openid: OPENID,
          type: 'recharge',
          amount,
          beforeBalance,
          afterBalance,
          status: 'success',
          channel: 'mock',
          createTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u, amount, beforeBalance, afterBalance };
    }

    if (action === 'withdraw') {
      const amount = asPositiveInt(event.amount);
      if (!amount) return { code: 400, message: '提现金额需为正整数' };
      const currentBalance = parseInt(me.pointsBalance || 0, 10) || 0;
      if (currentBalance < amount) return { code: 400, message: '工分余额不足' };
      const afterBalance = currentBalance - amount;
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          pointsBalance: _.inc(-amount),
          updateTime: db.serverDate()
        }
      });
      await db.collection('wallet_logs').add({
        data: {
          openid: OPENID,
          type: 'withdraw',
          amount,
          beforeBalance: currentBalance,
          afterBalance,
          status: 'success',
          channel: 'mock',
          createTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u, amount, beforeBalance: currentBalance, afterBalance };
    }

    if (action === 'walletLogs') {
      const r = await db
        .collection('wallet_logs')
        .where({ openid: OPENID })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      return { code: 0, list: r.data || [] };
    }

    if (action === 'setRole') {
      const role = event.role;
      if (role !== 'student' && role !== 'publisher') {
        return { code: 400, message: '角色只能是 student 或 publisher' };
      }
      const v = pickRoleVerify(me, role);
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          role,
          verifyStatus: v.status,
          verifyPayload: v.payload,
          updateTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u };
    }

    if (action === 'switchBackAdmin') {
      if (!me.isAdmin && me.role !== 'admin') {
        return { code: 403, message: '仅管理员账号可回退' };
      }
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          role: 'admin',
          isAdmin: true,
          verifyStatus: 'approved',
          updateTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u };
    }

    if (action === 'submitVerify') {
      if (me.role === 'admin') {
        return { code: 400, message: '管理员无需认证' };
      }
      const payload = event.payload || {};
      if (me.role === 'student') {
        if (!payload.studentNo || !payload.realName) {
          return { code: 400, message: '请填写学号与姓名' };
        }
      } else if (me.role === 'publisher') {
        if (!payload.workNo || !payload.unitName) {
          return { code: 400, message: '请填写工号/商户编号与单位名称' };
        }
      } else {
        return { code: 400, message: '请先选择身份' };
      }
      await db.collection('users').where({ openid: OPENID }).update({
        data:
          me.role === 'student'
            ? {
                verifyStatus: 'pending',
                verifyPayload: payload,
                studentVerifyStatus: 'pending',
                studentVerifyPayload: payload,
                updateTime: db.serverDate()
              }
            : {
                verifyStatus: 'pending',
                verifyPayload: payload,
                publisherVerifyStatus: 'pending',
                publisherVerifyPayload: payload,
                updateTime: db.serverDate()
              }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u };
    }

    if (action === 'adminListPendingUsers') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const r = await db.collection('users').orderBy('updateTime', 'desc').limit(100).get();
      const list = [];
      for (const u of r.data) {
        const studentPending =
          u.studentVerifyStatus === 'pending' || (u.role === 'student' && u.verifyStatus === 'pending');
        const publisherPending =
          u.publisherVerifyStatus === 'pending' || (u.role === 'publisher' && u.verifyStatus === 'pending');

        if (studentPending) {
          list.push({
            ...u,
            applyRole: 'student',
            verifyPayload: u.studentVerifyPayload || (u.role === 'student' ? u.verifyPayload || {} : {})
          });
        }
        if (publisherPending) {
          list.push({
            ...u,
            applyRole: 'publisher',
            verifyPayload: u.publisherVerifyPayload || (u.role === 'publisher' ? u.verifyPayload || {} : {})
          });
        }
      }
      return { code: 0, list };
    }

    if (action === 'adminApproveUser') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const targetOpenid = event.targetOpenid;
      const applyRole = event.applyRole || '';
      if (!targetOpenid) return { code: 400, message: '缺少 targetOpenid' };
      if (applyRole !== 'student' && applyRole !== 'publisher') {
        return { code: 400, message: '缺少 applyRole' };
      }
      const target = await getUserByOpenid(targetOpenid);
      if (!target) return { code: 404, message: '用户不存在' };
      const patch = { updateTime: db.serverDate() };
      if (applyRole === 'student') {
        patch.studentVerifyStatus = 'approved';
        if (target.role === 'student') {
          patch.verifyStatus = 'approved';
          patch.verifyPayload = target.studentVerifyPayload || target.verifyPayload || {};
        }
      } else {
        patch.publisherVerifyStatus = 'approved';
        if (target.role === 'publisher') {
          patch.verifyStatus = 'approved';
          patch.verifyPayload = target.publisherVerifyPayload || target.verifyPayload || {};
        }
      }
      await db.collection('users').where({ openid: targetOpenid }).update({
        data: patch
      });
      return { code: 0 };
    }

    if (action === 'adminRejectUser') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const targetOpenid = event.targetOpenid;
      const applyRole = event.applyRole || '';
      if (!targetOpenid) return { code: 400, message: '缺少 targetOpenid' };
      if (applyRole !== 'student' && applyRole !== 'publisher') {
        return { code: 400, message: '缺少 applyRole' };
      }
      const target = await getUserByOpenid(targetOpenid);
      if (!target) return { code: 404, message: '用户不存在' };
      const patch = {
        verifyRejectReason: event.reason || '',
        updateTime: db.serverDate()
      };
      if (applyRole === 'student') {
        patch.studentVerifyStatus = 'rejected';
        if (target.role === 'student') {
          patch.verifyStatus = 'rejected';
          patch.verifyPayload = target.studentVerifyPayload || target.verifyPayload || {};
        }
      } else {
        patch.publisherVerifyStatus = 'rejected';
        if (target.role === 'publisher') {
          patch.verifyStatus = 'rejected';
          patch.verifyPayload = target.publisherVerifyPayload || target.verifyPayload || {};
        }
      }
      await db.collection('users').where({ openid: targetOpenid }).update({
        data: patch
      });
      return { code: 0 };
    }

    if (action === 'adminFallbackToStudent') {
      const a = assertAdmin(me);
      if (!a.ok) return a.err;
      const v = pickRoleVerify(me, 'student');
      await db.collection('users').where({ openid: OPENID }).update({
        data: {
          role: 'student',
          verifyStatus: v.status,
          verifyPayload: v.payload,
          updateTime: db.serverDate()
        }
      });
      const u = await getUserByOpenid(OPENID);
      return { code: 0, user: u };
    }

    return { code: 404, message: '未知 action' };
  } catch (e) {
    console.error(e);
    return { code: 500, message: String(e) };
  }
};
