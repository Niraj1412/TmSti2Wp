/**
 * @format
 */
import './android/app/src/utils/polyfills';
import { registerRootComponent } from 'expo';
import App from './App';

// Register the app for native and web via Expo
registerRootComponent(App);

