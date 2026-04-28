const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 首次体验：把你的 openid 填进数组，部署后微信登录一次即可升为管理员；完成后请改回 [] 并重新部署
const BOOTSTRAP_ADMIN_OPENIDS = [];

async function ensureCollection(name) {
  // 有些情况下集合不会自动创建，这里做一次兜底
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合可能已存在，或创建失败原因非关键（后续逻辑会报错）
    console.error('ensureCollection createCollection failed:', name, e && (e.errMsg || e.message || e));
  }
}

function pickPrimaryUser(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return null;
  const admin = arr.find((u) => u && u.role === 'admin');
  if (admin) return admin;
  return arr[0];
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { userInfo } = event;

  if (!openid) {
    return { code: 1, message: '获取 openid 失败' };
  }

  const users = db.collection('users');

  try {
    await ensureCollection('users');

    // users 集合可能在首次登录前不存在：这里容错，确保能创建集合并写入首条数据
    let exist;
    try {
      exist = await users.where({ openid }).get();
    } catch (e) {
      console.error('users 查询失败，可能集合尚不存在：', e);
      exist = { data: [] };
    }
    const now = db.serverDate();

    if (userInfo) {
      if (exist.data.length === 0) {
        await users.add({
          data: {
            openid,
            nickName: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl,
            role: 'student',
            verifyStatus: 'none',
            pointsBalance: 0,
            verifyPayload: {},
            createTime: now,
            updateTime: now
          }
        });
      } else {
        const u = pickPrimaryUser(exist.data) || {};
        const patch = {
          updateTime: now
        };
        // 已有用户资料时，避免每次登录都被微信资料覆盖：
        // 仅当数据库字段为空时，才用微信资料兜底补齐。
        if (!u.nickName && userInfo.nickName) patch.nickName = userInfo.nickName;
        if (!u.avatarUrl && userInfo.avatarUrl) patch.avatarUrl = userInfo.avatarUrl;
        if (u.role == null) patch.role = 'student';
        if (u.verifyStatus == null) patch.verifyStatus = 'none';
        if (u.pointsBalance == null) patch.pointsBalance = 0;
        if (u.verifyPayload == null) patch.verifyPayload = {};
        if (u.role === 'admin' && !u.isAdmin) patch.isAdmin = true;
        await users.where({ openid }).update({ data: patch });
      }
    }

    // 若 userInfo 为空但用户不存在，也创建占位用户（避免后续页面取不到用户记录）
    if (!userInfo && exist.data.length === 0) {
      await users.add({
        data: {
          openid,
          nickName: '',
          avatarUrl: '',
          role: 'student',
          verifyStatus: 'none',
          pointsBalance: 0,
          verifyPayload: {},
          verifyRejectReason: '',
          createTime: now,
          updateTime: now
        }
      });
    }

    let after = await users.where({ openid }).get();
    let user = pickPrimaryUser(after.data);

    if (user && user.role === 'admin' && !user.isAdmin) {
      await users.where({ openid }).update({
        data: {
          isAdmin: true,
          updateTime: db.serverDate()
        }
      });
      after = await users.where({ openid }).get();
      user = pickPrimaryUser(after.data) || user;
    }

    if (
      user &&
      BOOTSTRAP_ADMIN_OPENIDS.length > 0 &&
      BOOTSTRAP_ADMIN_OPENIDS.indexOf(openid) !== -1 &&
      user.role !== 'admin'
    ) {
      await users.where({ openid }).update({
        data: {
          isAdmin: true,
          role: 'admin',
          verifyStatus: 'approved',
          updateTime: db.serverDate()
        }
      });
      after = await users.where({ openid }).get();
      user = pickPrimaryUser(after.data) || user;
    }

    if (user && user.isAdmin && user.role !== 'admin') {
      await users.where({ openid }).update({
        data: {
          role: 'admin',
          verifyStatus: 'approved',
          updateTime: db.serverDate()
        }
      });
      after = await users.where({ openid }).get();
      user = pickPrimaryUser(after.data) || user;
    }

    return {
      code: 0,
      message: 'success',
      openid,
      user
    };
  } catch (err) {
    console.error(err);
    return { code: 2, message: '数据库操作失败', error: String(err) };
  }
};
