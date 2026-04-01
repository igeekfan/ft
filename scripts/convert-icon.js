const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '..', 'build', 'logo.svg');
const pngPath = path.join(__dirname, '..', 'build', 'appicon.png');

async function convertSvgToPng() {
  try {
    const svgBuffer = fs.readFileSync(svgPath);
    
    // 生成不同尺寸的图标
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    
    for (const size of sizes) {
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(path.join(__dirname, '..', 'build', `appicon-${size}.png`));
      
      console.log(`Generated ${size}x${size} PNG`);
    }
    
    // 生成主要的 appicon.png (1024x1024)
    await sharp(svgBuffer)
      .resize(1024, 1024)
      .png()
      .toFile(pngPath);
    
    console.log('Generated main appicon.png (1024x1024)');
    
    // 生成 Windows ICO 格式需要的 PNG
    await sharp(svgBuffer)
      .resize(256, 256)
      .png()
      .toFile(path.join(__dirname, '..', 'build', 'windows', 'icon.png'));
    
    console.log('Generated Windows icon.png (256x256)');
    
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);
    process.exit(1);
  }
}

convertSvgToPng();