import './style.css';
import { createApp } from './ui';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app element');
createApp(root);
