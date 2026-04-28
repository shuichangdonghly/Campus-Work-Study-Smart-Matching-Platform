const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // ignore
  }
}

function randomSignCode() {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

async function getJob(jobId) {
  const r = await db.collection('jobs').doc(jobId).get();
  return (r && r.data) || null;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, message: '未登录' };

  const orderId = String(event.orderId || '')
    .trim();
  if (!orderId) return { code: 400, message: '缺少 orderId' };

  await Promise.all([ensureCollection('work_orders'), ensureCollection('jobs')]);

  try {
    const r = await db.collection('work_orders').doc(orderId).get();
    const order = (r && r.data) || null;
    if (!order) return { code: 404, message: '订单不存在' };

    const job = await getJob(order.jobId);
    if (!job) return { code: 404, message: '订单关联工作不存在' };

    const ownerOpenid = order.publisherOpenid || job.publisherOpenid;
    if (ownerOpenid !== OPENID) {
      return { code: 403, message: '仅该工作发布方可生成签到码' };
    }
    if (order.status === 'completed' || order.status === 'closed') {
      return { code: 400, message: `订单已结束，不能再生成签到码（当前状态：${order.status}）` };
    }
    if (order.signTime) {
      return { code: 400, message: '该订单已签到，无需重复生成签到码' };
    }

    const signCode = randomSignCode();
    const signCodeExpireAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.collection('work_orders').doc(orderId).update({
      data: {
        signCode,
        signCodeExpireAt,
        signCodeUsed: false,
        updateTime: db.serverDate()
      }
    });

    return { code: 0, signCode, expireAt: signCodeExpireAt };
  } catch (e) {
    console.error(e);
    return { code: 500, message: String(e) };
  }
};
