const { app, BrowserWindow, ipcMain, Menu } = require('electron');

const path = require('path');
const fs = require("fs");
const { performance } = require("perf_hooks");
const wavFileInfo = require("wav-file-info");

// electron boilerplate

if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true,
      enableRemoteModule: true,
      devTools: true,
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if(!app.isPackaged || process.argv.includes("--debug")) // assume we are in development if app is not packaged
    mainWindow.webContents.openDevTools();
  
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menu = new Menu()
  
    // Add each spelling suggestion
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => mainWindow.webContents.replaceMisspelling(suggestion)
      }))
    }
  
    // Allow users to add the misspelled word to the dictionary
    if (params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
      )
    }
  
    menu.popup()
  });
};

// enable spellcheck context menu

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// main code

let currentWorkingDirectory;

ipcMain.on("fileDropped", (event, rootPath) => {
  if(!fs.statSync(rootPath).isDirectory()) return event.reply("fileDropResult", {error: "Not a folder"});

  currentWorkingDirectory = rootPath
  const fileList = fs.readdirSync(rootPath);

  // progress handling
  let settledPromises = 0;
  let then = performance.now();
  
  const progressCallback = () => {
    settledPromises++;
    
    const now = performance.now();
    if((now - then) > 10) { // wait at least 10ms before sending next update
      then = now;
      
      event.reply("fileDropProgress", {
        total: fileList.length,
        done: settledPromises
      });
    }
  }
  
  const filePromises = [];

  // check the header of each wav file for information
  for(const fileName of fileList) {
    if(!fileName.endsWith(".wav")) continue; // ignore non-wav files

    const promise = new Promise((resolve, reject) => {
      const filePath = path.join(rootPath, fileName);
      wavFileInfo.infoByFilename(filePath, (err, info) => {
        if(err) return reject({error: err, fileName: fileName});

        // check for existing text files
        let savedText;
        try {
          savedText = fs.readFileSync(path.join(rootPath, path.parse(fileName).name + ".txt")).toString();
        } catch (error) {} // assume file doesn't exist
        
        resolve({
          rootPath: rootPath,
          fileName: fileName,
          format: info.header.audio_format,
          channels: info.header.num_channels,
          sampleRate: info.header.sample_rate,
          duration: info.duration,
          savedText: savedText,
        });
      });
    });

    filePromises.push(
      promise
      .then((data) => {progressCallback(); return data})
      .catch((err) => {progressCallback(); throw err})
    );
  }

  Promise.allSettled(filePromises).then(results => {
    event.reply("fileDropProgress", {
      total: fileList.length,
      done: settledPromises
    });

    event.reply("fileDropResult", results);
  }).catch(err => {
    event.reply("fileDropResult", {error: err});
  });
});


ipcMain.on("saveFile", (event, path, data) => {
  //console.log("saving: "+path);
  fs.writeFile(path, data, (err) => {
    if(err)
      event.reply("saveFileResult", {error: err});
    else
      event.reply("saveFileResult", {result: "success"});
  });
});

ipcMain.on("export", (event, fileList) => {
  let transcriptLines = [];
  
  for(const file of fileList) {
    const fileObject = path.parse(path.join(currentWorkingDirectory, file));
    
    let transcript = "";
    try {
      transcript = fs.readFileSync(path.join(fileObject.dir, fileObject.name + ".txt"));
    } catch (err) {
      event.reply("exportError", {error: "Could not read file: "+file+" "+err.message});
    }

    transcriptLines.push(`wavs/${file}|${transcript}`);
  }

  const transcriptData = transcriptLines.join("\n");
  const outputPath = path.join(currentWorkingDirectory, "transcript.txt");
  
  fs.writeFileSync(outputPath, transcriptData);
  event.reply("exportSuccess", {outputPath: outputPath});
});