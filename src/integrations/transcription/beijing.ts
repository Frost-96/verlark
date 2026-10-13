/** Public configuration boundary shared by application startup and the Adapter. */
export function isBeijingAsrHost(host: string) {
  return (
    host === "dashscope.aliyuncs.com" ||
    /^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(host)
  );
}
