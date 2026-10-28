// Development preview only. The installed popup uses the Chrome service worker.
import {rpc} from './platform.mjs';
rpc('check').catch(()=>{});
