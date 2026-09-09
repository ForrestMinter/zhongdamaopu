// 喂食打卡：打卡、记录列表、统计（喂食/零食已合并，地点与食物类型来自管理员自定义列表）
import { getCatItem } from "../../../utils/cat";
import { getUser } from "../../../utils/user";
import api from "../../../utils/cloudApi";
import { formatDate } from "../../../utils/utils";

Page({
  data: {
    cat: {},
    stats: {
      total: 0,
      meal_total: 0,
      snack_total: 0,
      meal_last7d: 0,
      snack_last7d: 0,
      last30d: 0,
      last_feed: null,
    },
    records: [],
    loading: true,
    todayChecked: false,
    // 打卡表单
    showCheckinModal: false,
    locations: [],           // 管理员自定义地点
    locationOptions: [],     // 自定义地点 + "其他（手动输入）"
    showCustomLocation: false,
    snackTypes: [],
    form: {
      feed_date: '',
      feed_time: '',
      locationIndex: -1,
      custom_location: '',
      snackTypeIndex: 0,
      note: '',
    },
    submitting: false,
  },

  jsData: {
    cat_id: '',
    myOpenid: '',
  },

  async onLoad(options) {
    this.jsData.cat_id = options.cat_id;
    if (!this.jsData.cat_id) {
      wx.showToast({ title: '缺少猫咪信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const cat = await getCatItem(this.jsData.cat_id);
    this.setData({ cat: cat || {} });
    if (cat && cat.name) {
      wx.setNavigationBarTitle({ title: `${cat.name}的打卡` });
    }

    this.jsData.myOpenid = await api.getCurrentUserOpenid();

    const now = new Date();
    this.setData({
      'form.feed_date': formatDate(now, 'yyyy-MM-dd'),
      'form.feed_time': `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    });

    await Promise.all([this.loadAll(), this.loadLocations(), this.loadSnackTypes()]);
  },

  async onShow() {
    if (this.jsData.cat_id) {
      await this.loadAll();
    }
  },

  async loadAll() {
    await Promise.all([this.loadStats(), this.loadRecords()]);
    this.setData({ loading: false });
  },

  // 管理员自定义的打卡地点
  async loadLocations() {
    try {
      const res = await api.feedOp({ operation: 'getLocations' });
      if (res.result) {
        const locations = res.data || [];
        this.setData({
          locations,
          locationOptions: locations.concat(['其他（手动输入）']),
        });
      }
    } catch (err) {
      console.error('[loadLocations] - 加载打卡地点失败:', err);
    }
  },

  // 食物类型
  async loadSnackTypes() {
    try {
      const res = await api.feedOp({ operation: 'getSnackTypes' });
      if (res.result) {
        this.setData({ snackTypes: res.data || [] });
      }
    } catch (err) {
      console.error('[loadSnackTypes] - 加载食物类型失败:', err);
    }
  },

  async loadStats() {
    try {
      const res = await api.feedOp({ operation: 'statsByCat', cat_id: this.jsData.cat_id });
      if (res.result && res.data) {
        const stats = res.data;
        if (stats.last_feed) {
          stats.last_feed.created_at_formatted = formatDate(stats.last_feed.created_at, 'yyyy-MM-dd hh:mm');
        }
        this.setData({ stats });
      }
    } catch (err) {
      console.error('[loadStats] - 加载喂食统计失败:', err);
    }
  },

  async loadRecords() {
    try {
      const res = await api.feedOp({
        operation: 'listByCat',
        cat_id: this.jsData.cat_id,
        limit: 50,
      });
      if (res.result) {
        const today = formatDate(new Date(), 'yyyy-MM-dd');
        let todayChecked = false;
        const records = (res.data || []).map(r => {
          if (r._openid === this.jsData.myOpenid && r.feed_date === today) {
            todayChecked = true;
          }
          return {
            ...r,
            created_at_formatted: formatDate(r.created_at, 'yyyy-MM-dd hh:mm'),
            isMine: r._openid === this.jsData.myOpenid,
          };
        });
        this.setData({ records, todayChecked });
      }
    } catch (err) {
      console.error('[loadRecords] - 加载喂食记录失败:', err);
    }
  },

  openCheckin() {
    if (this.data.todayChecked) {
      wx.showToast({ title: '今天已经打过卡啦', icon: 'none' });
      return;
    }
    this.setData({ showCheckinModal: true });
  },

  closeCheckin() {
    this.setData({ showCheckinModal: false });
  },

  onDateChange(e) {
    this.setData({ 'form.feed_date': e.detail.value });
  },

  onTimeChange(e) {
    this.setData({ 'form.feed_time': e.detail.value });
  },

  onLocationChange(e) {
    const index = Number(e.detail.value);
    // 最后一项是"其他（手动输入）"
    const showCustom = index === this.data.locations.length;
    this.setData({
      'form.locationIndex': index,
      showCustomLocation: showCustom,
      'form.custom_location': showCustom ? this.data.form.custom_location : '',
    });
  },

  onSnackTypeChange(e) {
    this.setData({ 'form.snackTypeIndex': Number(e.detail.value) });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async submitCheckin() {
    const { form, submitting, locations, snackTypes, showCustomLocation } = this.data;
    if (submitting) return;

    // 地点：从自定义列表选择或手动输入
    let location = '';
    if (showCustomLocation) {
      location = form.custom_location.trim();
    } else if (form.locationIndex >= 0 && locations[form.locationIndex]) {
      location = locations[form.locationIndex];
    }

    // 喂了什么（统一选项，喂食/零食不再区分）
    const food_type = snackTypes[form.snackTypeIndex] || '';
    if (!food_type) {
      wx.showToast({ title: '请选择喂了什么', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '打卡中...' });

    let userName = '';
    try {
      const user = await getUser();
      userName = (user && user.userInfo && user.userInfo.nickName) || '';
    } catch (e) { /* 忽略 */ }

    try {
      const res = await api.feedOp({
        operation: 'checkin',
        data: {
          cat_id: this.jsData.cat_id,
          food_type: food_type,
          feed_date: form.feed_date,
          feed_time: form.feed_time,
          location: location,
          note: form.note.trim(),
          user_name: userName,
        },
      });
      wx.hideLoading();
      wx.showToast({ title: res.msg || (res.result ? '打卡成功' : '打卡失败'), icon: 'none' });
      if (res.result) {
        this.closeCheckin();
        await this.loadAll();
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[submitCheckin] - 打卡失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async removeRecord(e) {
    const id = e.currentTarget.dataset.id;
    const modalRes = await wx.showModal({
      title: '删除打卡',
      content: '确定删除这条打卡记录吗？',
    });
    if (!modalRes.confirm) return;

    try {
      const res = await api.feedOp({ operation: 'remove', checkin_id: id });
      wx.showToast({ title: res.msg || (res.result ? '已删除' : '删除失败'), icon: 'none' });
      if (res.result) {
        await this.loadAll();
      }
    } catch (err) {
      console.error('[removeRecord] - 删除失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },
});
