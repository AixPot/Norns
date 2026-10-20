export function positionPanel(anchor,width,height,viewportWidth,viewportHeight){
 const gap=12;
 const right=anchor.right+gap,left=anchor.left-width-gap;
 const preferred=right+width<=viewportWidth-gap?right:left>=gap?left:viewportWidth-anchor.right>=anchor.left?right:left;
 return {left:Math.max(gap,Math.min(preferred,viewportWidth-width-gap)),top:Math.max(gap,Math.min(anchor.top,viewportHeight-height-gap))};
}
