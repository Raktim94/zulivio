import { isPrivateAddress } from "./url-safety";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.1.1", "169.254.169.254", "::1", "::", "fe80::1", "fd00::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "0:0:0:0:0:ffff:c0a8:1",
    "64:ff9b::7f00:1", "2002:7f00:1::1",
  ])("blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "2606:4700:4700::1111", "::ffff:0808:0808", "64:ff9b::808:808"])(
    "allows public %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});
