import { render } from 'preact';
import { bootstrap } from './store';
import { App } from './App';
import './styles.css';
import './refinement.css';

void bootstrap();

render(<App />, document.getElementById('root')!);
