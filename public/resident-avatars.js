/* global document */
(()=>{'use strict';const failed=image=>{if(image.matches?.('img[data-resident-avatar]'))image.hidden=true;};document.addEventListener('error',event=>failed(event.target),true);for(const image of document.querySelectorAll('img[data-resident-avatar]'))if(image.complete&&!image.naturalWidth)failed(image);})();
