/**
 * @format
 */
import './polyfills';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Register your main component with React Native
AppRegistry.registerComponent(appName, () => App);
