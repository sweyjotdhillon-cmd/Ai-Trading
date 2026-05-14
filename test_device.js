const isIOS = typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window.MSStream);

const isScreenShareSupported = !isIOS &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function";

console.log("isIOS", isIOS);
console.log("isScreenShareSupported", isScreenShareSupported);
