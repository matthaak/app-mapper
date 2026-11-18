import './theme.css';
import { MapperApp } from './modules/mapper';

const app = new MapperApp(document.getElementById('app')!);
if (import.meta.env.DEV) Object.assign(window, { app });
