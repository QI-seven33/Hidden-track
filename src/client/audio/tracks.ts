/** 音频清单。文件放在 public/audio 下，随包发布；顺序即播放顺序。 */
export type BgmTrack = {
  id: string;
  title: string;
  artist: string;
  file: string;
  /** 作品页，设置里的「音乐出处」直接引用 */
  source: string;
  site: 'Pixabay' | 'Freesound' | '自备';
  license: string;
};

export const BGM_TRACKS: BgmTrack[] = [
  {
    id: 'hitslab-300654',
    title: 'Upbeat',
    artist: 'HitsLab',
    file: '/audio/bgm/01-hitslab-upbeat.mp3',
    source: 'https://pixabay.com/music/upbeat-upbeat-music-300654/',
    site: 'Pixabay',
    license: 'Pixabay Content License',
  },
  {
    id: 'ikoliks-628248',
    title: 'Upbeat Music',
    artist: 'ikoliks_aj',
    file: '/audio/bgm/02-ikoliks-upbeat.mp3',
    source: 'https://pixabay.com/music/upbeat-upbeat-music-628248/',
    site: 'Pixabay',
    license: 'Pixabay Content License',
  },
  {
    id: 'warm-story-627308',
    title: 'Chill Advertising Music (Warm Story)',
    artist: 'Strawberry_Candy',
    file: '/audio/bgm/03-chill-warm-story.mp3',
    source:
      'https://pixabay.com/music/chill-advertising-music-warm-story-627308/',
    site: 'Pixabay',
    license: 'Pixabay Content License',
  },
  {
    id: 'sport-metal-622134',
    title: 'Sport Intense Metal (Fast and Strong)',
    artist: 'Strawberry_Candy',
    file: '/audio/bgm/04-sport-intense-metal.mp3',
    source:
      'https://pixabay.com/music/sport-intense-metal-fast-and-strong-622134/',
    site: 'Pixabay',
    license: 'Pixabay Content License',
  },
  {
    id: 'energetic-484394',
    title: 'Energetic_23Sec',
    artist: 'prettyjohn1',
    file: '/audio/bgm/05-energetic-percussion.mp3',
    source: 'https://pixabay.com/sound-effects/musical-energetic-23sec-484394/',
    site: 'Pixabay',
    license: 'Pixabay Content License',
  },
  {
    id: 'romantic-0601',
    title: '罗曼蒂克',
    artist: '未署名',
    file: '/audio/bgm/06-romantic.mp3',
    source: '',
    site: '自备',
    license: '用户自备素材，未标注授权',
  },
];

export type SfxKind = 'card' | 'event' | 'clue' | 'reveal';

export const SFX_FILES: Record<SfxKind, string> = {
  card: '/audio/sfx/card.mp3',
  event: '/audio/sfx/event-open.mp3',
  clue: '/audio/sfx/clue-gain.mp3',
  // 对局结束横幅砸入时的节拍铺底，3.5s 循环素材，实际只取前 1.3s 并淡出。
  reveal: '/audio/sfx/reveal-loop.mp3',
};

export const SFX_CREDITS = [
  {
    title: '卡牌',
    usage: '出牌 / 摸牌',
    source: '用户自备素材',
    url: '',
    license: '',
  },
  {
    title: 'material mold',
    usage: '事件选择',
    source: 'Freesound #394512',
    url: 'https://freesound.org/people/gamestudio/sounds/394512/',
    license: 'Freesound（按作品页 CC 条款）',
  },
  {
    title: 'accepter 2',
    usage: '获得线索',
    source: 'Freesound #394924',
    url: 'https://freesound.org/people/alexis_gaming_cam/sounds/394924/',
    license: 'Freesound（按作品页 CC 条款）',
  },
  {
    title: 'hi-hat loop',
    usage: '对局结算',
    source: 'Freesound #101166',
    url: 'https://freesound.org/s/101166/',
    license: 'Freesound（按作品页 CC 条款）',
  },
];
