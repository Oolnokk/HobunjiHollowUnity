(() => {
 'use strict';
 // The PNG artwork's +Y is transformed to world +Y, independent of body yaw,
 // sprite-plane basis and author-defined idle pitch. Never applied during attacks.
 function apply(holder,plane,THREE) {
   if (!holder || !plane || !THREE) return false;
   const parentQ=holder.parent?.getWorldQuaternion?.(new THREE.Quaternion()) || new THREE.Quaternion();
   const spriteQ=plane.parent?.quaternion || new THREE.Quaternion();
   const imageUp=new THREE.Vector3(0,1,0).applyQuaternion(plane.quaternion)
     .applyQuaternion(spriteQ).applyQuaternion(holder.quaternion).applyQuaternion(parentQ).normalize();
   if (!Number.isFinite(imageUp.x) || imageUp.lengthSq()<1e-8) return false;
   const worldCorrection=new THREE.Quaternion().setFromUnitVectors(imageUp,new THREE.Vector3(0,1,0));
   holder.quaternion.premultiply(parentQ.clone().invert().multiply(worldCorrection).multiply(parentQ));
   return true;
 }
 window.ToolWorldUpright=Object.freeze({apply});
})();
