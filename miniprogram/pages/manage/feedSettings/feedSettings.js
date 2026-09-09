// 喂食设置（管理员）：自定义打卡地点、食物类型
import { checkAuth } from "../../../utils/user";
import api from "../../../utils/cloudApi";

Page({
  data: {
    locations: [],
    snackTypes: [],
    newLocation: '',
    newSnackType: '',
    loading: true,
  },

  async onLoad() {
    if (await checkAuth(this, 2)) {
      await this.loadAll();
    }
  },

  async loadAll() {
    this.setData({ loading: true });
    await Promise.all([this.loadLocations(), this.loadSnackTypes()]);
    this.setData({ loading: false });
  },

  async loadLocations() {
    try {
      const res = await api.feedOp({ operation: 'getLocations' });
      if (res.result) {
        this.setData({ locations: res.data || [] });
      }
    } catch (err) {
      console.error('[loadLocations] - 失败:', err);
    }
  },

  async loadSnackTypes() {
    try {
      const res = await api.feedOp({ operation: 'getSnackTypes' });
      if (res.result) {
        this.setData({ snackTypes: res.data || [] });
      }
    } catch (err) {
      console.error('[loadSnackTypes] - 失败:', err);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  async addLocation() {
    const location = this.data.newLocation.trim();
    if (!location) {
      wx.showToast({ title: '请输入地点名称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '添加中...' });
    try {
      const res = await api.feedOp({ operation: 'addLocation', location });
      wx.hideLoading();
      wx.showToast({ title: res.msg || (res.result ? '添加成功' : '添加失败'), icon: 'none' });
      if (res.result) {
        this.setData({ locations: res.data, newLocation: '' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[addLocation] - 失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  async removeLocation(e) {
    const location = e.currentTarget.dataset.location;
    const modalRes = await wx.showModal({
      title: '删除地点',
      content: `确定删除「${location}」吗？已打卡记录中的地点不受影响。`,
    });
    if (!modalRes.confirm) return;

    try {
      const res = await api.feedOp({ operation: 'removeLocation', location });
      wx.showToast({ title: res.msg || (res.result ? '已删除' : '删除失败'), icon: 'none' });
      if (res.result) {
        this.setData({ locations: res.data });
      }
    } catch (err) {
      console.error('[removeLocation] - 失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  async addSnackType() {
    const type = this.data.newSnackType.trim();
    if (!type) {
      wx.showToast({ title: '请输入类型名称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '添加中...' });
    try {
      const res = await api.feedOp({ operation: 'addSnackType', type });
      wx.hideLoading();
      wx.showToast({ title: res.msg || (res.result ? '添加成功' : '添加失败'), icon: 'none' });
      if (res.result) {
        this.setData({ snackTypes: res.data, newSnackType: '' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('[addSnackType] - 失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  async removeSnackType(e) {
    const type = e.currentTarget.dataset.type;
    const modalRes = await wx.showModal({
      title: '删除食物类型',
      content: `确定删除「${type}」吗？已有打卡记录使用的类型无法删除。`,
    });
    if (!modalRes.confirm) return;

    try {
      const res = await api.feedOp({ operation: 'removeSnackType', type });
      wx.showToast({ title: res.msg || (res.result ? '已删除' : '删除失败'), icon: 'none' });
      if (res.result) {
        this.setData({ snackTypes: res.data });
      }
    } catch (err) {
      console.error('[removeSnackType] - 失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },
});
