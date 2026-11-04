import './project.css';
import {bindTowerVideo} from './shared/tower-video.ts';

// This independent document uses only the shared, user-activated video control.
bindTowerVideo(document.body);
