// ZJUT CAS uses a small, legacy RSA implementation in the login page.
// This is the compatible raw-RSA operation implemented with native BigInt;
// it intentionally does not add a third-party crypto dependency.

function modPow(base, exponent, modulus) {
  let result = 1n % modulus;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}

function toFixedDigitHex(value) {
  const hex = value.toString(16);
  return hex.padStart(Math.max(4, Math.ceil(hex.length / 4) * 4), "0");
}

/**
 * Matches:
 *   password.split("").reverse().join("")
 *   RSAUtils.encryptedString(key, reversedPassword)
 * from the school's CAS login.js.
 */
export function encryptCasPassword(password, modulusHex, exponentHex) {
  const modulusText = String(modulusHex).replace(/^0+/, "");
  const exponentText = String(exponentHex).replace(/^0+/, "");
  if (!modulusText || !exponentText) {
    throw new Error("CAS 公钥格式无效");
  }

  const modulus = BigInt(`0x${modulusText}`);
  const exponent = BigInt(`0x${exponentText}`);
  const reversedPassword = String(password).split("").reverse().join("");
  const chars = [];
  for (let index = 0; index < reversedPassword.length; index += 1) {
    chars.push(reversedPassword.charCodeAt(index));
  }

  // The original implementation stores two UTF-16 code units in each
  // 16-bit BigInt digit and leaves one modulus digit unused.
  const digitCount = Math.ceil(modulusText.length / 4);
  const chunkSize = 2 * (digitCount - 1);
  if (chunkSize <= 0) throw new Error("CAS 公钥长度无效");
  while (chars.length % chunkSize !== 0) chars.push(0);

  const blocks = [];
  for (let offset = 0; offset < chars.length; offset += chunkSize) {
    let block = 0n;
    let digit = 0n;
    for (let index = offset; index < offset + chunkSize; index += 2) {
      const low = chars[index] ?? 0;
      const high = chars[index + 1] ?? 0;
      block |= BigInt(low + (high << 8)) << (16n * digit);
      digit += 1n;
    }
    blocks.push(toFixedDigitHex(modPow(block, exponent, modulus)));
  }
  return blocks.join(" ");
}
