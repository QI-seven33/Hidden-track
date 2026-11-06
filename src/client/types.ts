export type Meta = {
  fixtures: boolean;
  /** 人机练习开关：与测试数据独立，默认开启。 */
  practice?: boolean;
  developer?: boolean;
  playtest?: boolean;
  qqConfigured: boolean;
  qrConfigured: boolean;
  webLoginConfigured?: boolean;
  capabilities: { id: string; title: string; login: boolean }[];
};
export type Session = {
  name: string;
  /** QQ 音乐授权后回填的真实昵称与头像；未授权为空。 */
  nickname?: string;
  avatar?: string;
  qqAuthorized: boolean;
  expiresAt?: number;
};
