import QRCode from "qrcode";

export async function generateQRCode(url: string): Promise<string> {
  return await QRCode.toDataURL(url, {
    width: 400,
    margin: 2,
    color: {
      dark: "#1A2340",
      light: "#FFFFFF",
    },
  });
}
