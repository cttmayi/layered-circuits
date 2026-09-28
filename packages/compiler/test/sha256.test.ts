import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256Hex, stableStringify, toHex } from '../src/sha256.js';

describe('纯 TS SHA-256', () => {
  it('标准测试向量', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('跨块长度（>64 字节）也正确', () => {
    const text = 'a'.repeat(1000);
    expect(sha256Hex(text)).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('字节接口与十六进制一致', () => {
    expect(toHex(sha256Bytes(new TextEncoder().encode('abc')))).toBe(sha256Hex('abc'));
  });
});

describe('稳定序列化', () => {
  it('对象键顺序不影响结果，数组顺序影响结果', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('undefined 字段被忽略', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
