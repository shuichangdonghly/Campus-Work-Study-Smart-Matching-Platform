const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SIGNABLE_ORDER_STATUS = ['ongoing', 'pending_settlement', 'submitted'];

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // ignore
  }
}

function toTime(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, message: '未登录' };

  const orderId = String(event.orderId || '').trim();
  const signCode = String(event.signCode || '').trim();
  if (!orderId || !signCode) return { code: 400, message: '缺少 orderId 或 signCode' };

  await Promise.all([ensureCollection('work_orders')]);

  try {
    const od = await db.collection('work_orders').doc(orderId).get();
    const order = (od && od.data) || null;
    if (!order) {
      return { code: 404, message: '订单不存在' };
    }

    if (order.studentOpenid !== OPENID) {
      return { code: 403, message: '仅接单学生可签到' };
    }

    if (!SIGNABLE_ORDER_STATUS.includes(order.status)) {
      return { code: 400, message: `当前状态不可签到：${order.status}` };
    }
    if (order.signTime || order.signCodeUsed) {
      return { code: 400, message: '该订单已签到，请勿重复操作' };
    }

    const savedCode = String(order.signCode || '').trim();
    if (!savedCode || savedCode !== signCode) {
      return { code: 400, message: '签到码错误' };
    }

    const expireAt = toTime(order.signCodeExpireAt);
    if (!expireAt || expireAt < Date.now()) {
      return { code: 400, message: '签到码已过期' };
    }

    await db.collection('work_orders').doc(orderId).update({
      data: {
        signTime: db.serverDate(),
        status: 'submitted',
        signCode: '',
        signCodeExpireAt: null,
        signCodeUsed: true,
        updateTime: db.serverDate()
      }
    });

    return { code: 0, message: '签到成功，待商家确认完成' };
  } catch (e) {
    console.error(e);
    return { code: 500, message: String(e) };
  }
};
