import { ChatPacket } from '../../shared/types';

export interface ColoredSegment {
  text: string;
  color: string;
}

const GT_COLOR_CODES: Record<string, string> = {
  '0': '#ffffff',
  '1': '#adf4ff',
  '2': '#4ef55c', // Classic GT Bright Green!
  '3': '#9ec7ff',
  '4': '#ff4d4d', // Classic GT Bright Red!
  '5': '#ebb0ff',
  '6': '#ffbe3b', // Gold / Amber
  '7': '#cccccc',
  '8': '#ff944d',
  '9': '#ffee55', // Bright Yellow
  w: '#ffffff',
  b: '#52e5ff',
  p: '#ff82e6',
  o: '#ffa94d',
};

export class ChatManager {
  public messages: ChatPacket[] = [];
  private maxMessages = 80;
  private listeners: Array<(msg: ChatPacket) => void> = [];

  public onMessage(cb: (msg: ChatPacket) => void): void {
    this.listeners.push(cb);
  }

  public pushMessage(msg: ChatPacket): void {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
    for (const cb of this.listeners) cb(msg);
  }

  public addSystemMessage(text: string): void {
    this.pushMessage({
      id: `sys_${Date.now()}_${Math.random()}`,
      senderId: 'system',
      senderName: 'SYSTEM',
      text,
      type: 'system',
      timestamp: Date.now(),
    });
  }

  public clear(): void {
    this.messages = [];
  }

  public static parseColoredText(input: string, defaultColor = '#ffffff'): ColoredSegment[] {
    const segments: ColoredSegment[] = [];
    let currentColor = defaultColor;
    let buf = '';

    for (let i = 0; i < input.length; i++) {
      if (input[i] === '`' && i + 1 < input.length) {
        const code = input[i + 1].toLowerCase();
        if (GT_COLOR_CODES[code]) {
          if (buf.length > 0) {
            segments.push({ text: buf, color: currentColor });
            buf = '';
          }
          currentColor = GT_COLOR_CODES[code];
          i++;
          continue;
        }
      }
      buf += input[i];
    }

    if (buf.length > 0) {
      segments.push({ text: buf, color: currentColor });
    }
    return segments;
  }

  public static stripColorCodes(input: string): string {
    return input.replace(/`[0-9a-zA-Z]/g, '');
  }
}
