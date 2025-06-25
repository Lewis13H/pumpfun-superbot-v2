import { exec } from 'child_process';
import { platform } from 'os';

export function openDashboard(url: string) {
  const platformName = platform();
  let command: string;
  
  switch (platformName) {
    case 'darwin': // macOS
      command = `open ${url}`;
      break;
    case 'win32': // Windows
      command = `start ${url}`;
      break;
    default: // Linux and others
      command = `xdg-open ${url}`;
  }
  
  exec(command, (error) => {
    if (error) {
      console.log('Please open your browser and navigate to:', url);
    }
  });
}