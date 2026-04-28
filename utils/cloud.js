function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success(res) {
        const r = res.result;
        if (r && r.code === 0) resolve(r);
        else
          reject(
            r && typeof r === 'object'
              ? { ...r, message: r.message || '调用失败' }
              : { code: -1, message: '调用失败' }
          );
      },
      fail(err) {
        reject({ code: -1, message: err.errMsg || '网络错误' });
      }
    });
  });
}

module.exports = { call };
