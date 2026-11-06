const labels: Record<string, string> = {
  song_id: '歌曲数值 ID',
  song_mid: '歌曲 MID',
  song_name: '歌曲名',
  song_title: '显示名称（可能含版本）',
  song_version: '内容/版本类型，编码需结合接口解释',
  public_time: '该版本/专辑发行日期',
  song_play_time: '音频总时长（秒）',
  song_desc: '歌曲描述（不保证非空）',
  album_id: '专辑 ID',
  album_mid: '专辑 MID',
  album_name: '专辑名称',
  album_title: '专辑显示名称',
  album_trans_name: '专辑翻译名称',
  album_type: '专辑/内容类型',
  str_type: '专辑类型文字',
  str_language: '专辑层级语言',
  str_genre: '专辑层级流派',
  is_collection: '是否合集',
  company_id: '唱片公司 ID',
  company_name: '唱片公司名称',
  total_num: '专辑曲目总数',
  totla_num: '文档拼写中的曲目总数',
  album_desc: '专辑介绍正文',
  update_time: '更新时间',
  fav_cnt: '收藏计数（附加返回字段）',
  singer_id: '歌手 ID',
  singer_mid: '歌手 MID',
  singer_name: '歌手名称',
  singer_title: '歌手显示名称',
  singer_translator_name: '歌手翻译名',
  other_singer_list: '其他关联歌手',
  area: '歌手地区',
  identity: '歌手职业/身份编码',
  song_sum: '该歌手曲目数',
  concern_num: '关注人数（附加字段）',
  wikiInfo: '歌手百科 XML 正文',
  language: '该歌曲语言；为空时不能用专辑语言冒充',
  genre: '该歌曲流派；为空时不能用专辑流派冒充',
  author: '搜索接口的曲作者字段',
  origin: '接口的原唱标志，0 值覆盖需核验',
  hot: '当前用户是否喜欢该曲，不是流行热度',
  vip: 'VIP 歌曲标记',
  isdigital_album: '数字专辑标记',
  user_own_rule: '当前请求身份的浏览/播放权限',
  playable: '当前身份能否播放',
  try_playable: '当前身份能否试听',
  unplayable_code: '不能播放的原因编码',
  unplayable_msg: '不能播放的原因说明',
  try_begin: '试听起点（文档标注毫秒）',
  try_end: '试听终点（文档标注毫秒）',
  try_file_size: '试听文件大小（字节）',
  excited_begin: '歌曲详情副歌起点；授权样本为非零，匿名为 0，单位需校准',
  excited_end: '歌曲详情副歌终点；授权样本为非零，单位需校准',
  touchpointStart: 'MIR 副歌起点，保留原始数值，需校准单位',
  touchpointEnd: 'MIR 副歌终点，保留原始数值，需校准单位',
  bpm: '节拍速度字段；本轮 0 值不可当作真实 BPM',
  volume_gain: '音频增益',
  volume_peak: '采样峰值',
  volume_lra: '响度范围；不是节拍/情绪',
  mv_id: '关联 MV 数值 ID',
  mv_vid: '关联 MV 标识',
  k_song_id: 'K 歌 ID',
  k_song_mid: 'K 歌 MID',
  should_pay: '单曲或专辑购买要求',
  pay_price: '接口价格数值，计价单位需核验',
  buy_album: '当前用户是否已购专辑',
  has_buy_song: '当前用户是否已购单曲',
  lm_vip: '听书会员要求',
  vkeyLeftSec: '播放链接有效剩余秒数',
  has_more: '是否还有下一页',
  hasMore: '是否还有下一页',
  ret: '接口业务返回码',
  sub_ret: '辅助返回码',
  msg: '接口说明',
  vcheck: '登录态校验结果',
  traceId: '请求追踪 ID',
  ts: '服务端时间戳',
  characters: '文本字符数',
  nonEmpty: '文本是否非空',
  present: '敏感值是否存在；未下发原值',
};
export function musicFieldMeaning(path: string, section = ''): string {
  const key =
    path
      .split('.')
      .at(-1)
      ?.replace(/\[\d+\]/g, '') || path;
  if (key === 'type' && section === 'singer')
    return '歌手类型：0 男、1 女、2 组合等；不是单曲人声标签';
  if (/action\.(playAccess|downloadAccess|cacheAccess)/.test(path))
    return '各音质所需身份位；下载/缓存字段不代表本项目可以开放下载';
  if (/album_pic/.test(key)) return '专辑封面 URL / 尺寸变体';
  if (/singer_pic/.test(key)) return '歌手图片 URL / 尺寸变体';
  if (/song_size/.test(key))
    return '对应音质文件大小（字节，0 值可能受权限影响）';
  if (/song_play_url|try_30s_url|trackFiles|ekey|token/i.test(path))
    return '播放资源或票据；只展示存在状态';
  return labels[key] || '附加字段或结构节点：需核对语义后再用于规则';
}
