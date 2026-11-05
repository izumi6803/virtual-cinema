import { Html5Player } from './html5Player.js';
import { YouTubePlayer } from './youtubePlayer.js';

export function createPlayer(video) {
  if (!video || !video.src) return null;
  return video.kind === 'youtube' ? new YouTubePlayer(video.src) : new Html5Player(video.src);
}
