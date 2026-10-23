import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles.css';
import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { init } from './store';
import { App } from './ui/App';

registerSW({ immediate: true });

// Ask the browser not to evict our data under storage pressure.
void navigator.storage?.persist?.().catch(() => false);

render(<App />, document.getElementById('app')!);

init().catch((e: Error) => {
  const box = document.createElement('div');
  box.className = 'boot';
  box.textContent = `Could not open local storage: ${e.message}`;
  document.getElementById('app')!.replaceChildren(box);
});
