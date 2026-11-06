import { useSyncExternalStore } from 'react';
import { audioSnapshot, subscribeAudio } from './engine';

/** 订阅音频设置，组件里改完立刻重渲染。 */
export function useAudio() {
  return useSyncExternalStore(subscribeAudio, audioSnapshot, audioSnapshot);
}
