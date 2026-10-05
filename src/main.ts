import './style.css';
import { detectLanguage, onLanguageChange, setLanguage } from './i18n';
import { type Sequence } from './sequence';
import { type App, createApp } from './ui';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app element');

// The page is built in the visitor's language; a change rebuilds it with the
// same sequence at the same step.
let app: App | null = null;
const build = (carry?: { sequence: Sequence; position: number }): void => {
  root.replaceChildren();
  app = createApp(root);
  if (carry) void app.loadSequence(carry.sequence).then(() => app?.jumpTo(carry.position));
};
onLanguageChange(() => {
  const previous = app;
  if (!previous) return;
  const carry = { sequence: previous.exportSequence(), position: previous.timeline.position };
  previous.dispose();
  build(carry);
});
void setLanguage(detectLanguage(), false).then(() => build());
