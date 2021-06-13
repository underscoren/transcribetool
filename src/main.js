const { ipcRenderer, remote } = require('electron');
const $ = jQuery = require("./jquery-3.6.0.min.js");
const bootstrap = require("./bootstrap.bundle.min.js");
const Chart = require("./chart.min.js");


const currentWebContents = remote.getCurrentWebContents();
document.addEventListener('keyup', ({ key, ctrlKey, shiftKey, metaKey, altKey }) => {
    if (key === 'F12' || (ctrlKey && shiftKey && key === 'I') || (metaKey && altKey && key === 'i')) // F12 / Ctr+Shift+I / Cmd+Alt+I for mac
        currentWebContents.openDevTools();
});

// drag and drop handlers
document.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();

    $("#choose-folder").removeClass("drop");

    const droppedFile = event.dataTransfer.files[0];
    if(droppedFile) {
        ipcRenderer.send("fileDropped", droppedFile.path);
        $("#choose-folder").hide();
        $("#loading-div").show();
    }
});

document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener('dragenter', () => {
    $("#choose-folder").addClass("drop");
});

document.addEventListener('dragleave', () => {
    $("#choose-folder").removeClass("drop");
});


// progress update from main process 
ipcRenderer.on("fileDropProgress", (event, progressInfo) => {
    //console.log(progressInfo);
    const progressBar = $("#loading-progressbar");
    progressBar.text(`${progressInfo.done}/${progressInfo.total}`);
    progressBar.css("width", `${((progressInfo.done/progressInfo.total) * 100).toFixed(1)}%`);
});

// helper functions
const toHHMMSS = (secs) => {
    const sec_num = parseInt(secs, 10);
    const hours   = Math.floor(sec_num / 3600);
    const minutes = Math.floor(sec_num / 60) % 60;
    const seconds = sec_num % 60;

    return [hours,minutes,seconds]
        .map(num => num < 10 ? "0" + num : num)
        .filter((num, index) => num !== "00" || index > 0)
        .join(":");
}

// adds a tooltip to the element. each element in errorList is added as a new line
const createErrorTooltip = (element, errorList, placement = "left") => {
    element.attr("data-bs-toggle", "tooltip");
    element.attr("data-bs-placement", placement);
    element.attr("data-bs-html", "true");
    element.attr("title", `<ul class="list-unstyled mb-0">${errorList.map(str => `<li>${str}</li>`).join("")}</ul>`);
    return new bootstrap.Tooltip(element, {boundary: document.body});
}

let totalClips;

// file drop result from main process
// TODO: rewrite this massive function to make it more readable
ipcRenderer.on("fileDropResult", (event, resultArray) => {
    if(resultArray.error) {
        $("#choose-folder").show();
        $("#loading-div").hide();

        $("#fixed-bottom-container").append(
            $(`<div class="alert alert-danger alert-dismissible fade show" role="alert">
                Error: ${resultArray.error}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>`)
        );
    } else {
        console.log(resultArray);

        $("#loading-div").hide();
        const ul = $("#textbox-list");

        // stat counters
        totalClips = resultArray.length;
        let totalAudioDuration = 0;
        let averageAudioDuration = 0;
        let minAudioDuration = 9999;
        let maxAudioDuration = 0;
        let totalErroredClips = 0;
        let totalTranscribedClips = 0;
        let percentageTranscribedClips = 0;
        
        // create all textbox-related elements
        for(const output of resultArray) {
            if(output.status != "fulfilled") {
                $("#fixed-bottom-container").append(
                    $(`<div class="alert alert-danger alert-dismissible fade show" role="alert">
                        Error reading file ${output.reason.fileName}: ${output.reason.error.invalid_reasons[0]} 
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>`)
                );
                continue;
            }
            
            const data = output.value;

            // audio error checks
            const errors = []
            if(data.format != 1) errors.push("File is not 16-bit PCM format");
            if(data.channels != 1) errors.push("Audio is not Mono");
            if(data.sampleRate != 22050) errors.push("Audio is not in 22050Hz sample rate");
            if(data.duration < 1.5) errors.push("Audio is too short");
            if(data.duration > 12) errors.push("Audio is too long");

            totalAudioDuration += data.duration;
            minAudioDuration = Math.min(minAudioDuration, data.duration);
            maxAudioDuration = Math.max(maxAudioDuration, data.duration);

            // create elements
            const title = $(`<label class="mb-2 form-label"><strong>${data.fileName}</strong></span>`);
            const audioElement = $(`<audio class="col-3" controls src="file://${data.rootPath}/${data.fileName}">`);
            const textboxElement = $(`<input type="text" class="form-control highlight-text" data-audioname="${data.fileName}">`);
            const highlightsTextElement = $(`<div class="highlights">x</div>`); // hidden element behind textbox for realtime highlights of errors
            
            const baseFileName = data.fileName.substring(0, data.fileName.lastIndexOf("."));
            const textPath = `${data.rootPath}/${baseFileName}.txt`;

            // autosave function
            const saveFile = () => {
                ipcRenderer.send("saveFile", textPath, textboxElement.val());
            }

            // update and highlights text in highlights div
            const markText = (endCheck = true) => {
                let markedText = textboxElement.val();
                if(markedText.length == 0) 
                    return highlightsTextElement.html("x"); // if div has no content it collapses

                const invalidCharRegex = RegExp("(?![ A-Za-z\\'(),.:;?!-]+)[^ A-Za-z\\'(),.:;?!-]+", "g"); // check for any invalid characters
                const punctuationRegex = RegExp("[^.?!]$"); // check that the sentence ends in proper punctuation
                
                markedText = markedText.replace(invalidCharRegex, "<mark class='invalidCharsErr'>$&</mark>")
                if(endCheck)
                    markedText = markedText.replace(punctuationRegex, "<mark class='punctuationErr'>$&</mark>");
                
                // put marked text inside highlights div
                highlightsTextElement.html(markedText);

                const tooltips = [];

                // add tooltips to highlights
                highlightsTextElement
                    .children(".invalidCharsErr")
                    .each(function() {
                        const tooltip = createErrorTooltip($(this), [`Invalid character${($(this).text().length > 1) ? "s" : ""}`], "top");
                        tooltips.push(tooltip);
                    });
                
                if(endCheck) {
                    highlightsTextElement
                        .children(".punctuationErr")
                        .each(function() {
                            const tooltip = createErrorTooltip($(this), ["Missing punctuation", "Must end with . ! or ?"], "top");
                            tooltips.push(tooltip);
                        });
                }
                
                if(tooltips.length)
                    textboxElement.addClass("is-invalid");
                else
                    textboxElement.removeClass("is-invalid");
                
                // hack to force enable tootips in div behind textbox
                textboxElement.off("mouseenter mouseleave focus"); // remove old event handlers
                
                textboxElement.on("mouseenter", () => {
                    tooltips.forEach(tooltip => tooltip.show());
                });

                textboxElement.on("mouseleave focus input", () => {
                    tooltips.forEach(tooltip => tooltip.hide());
                });
            }

            textboxElement.on("change", () => {
                markText(); // mark all errors
                saveFile();

                // count all transcribed clips
                let transcribedClips = 0;
                $(".highlight-text").each(function() {
                    if($(this).val())
                        transcribedClips++;
                });

                // update UI
                $("#totalTranscribed").text(transcribedClips);
                $("#percentageTranscribed").text((transcribedClips/totalClips * 100).toFixed(1));
            });

            // autosave once the user stops typing
            const typingTimeout = 1000;
            let typingTimerID;
            textboxElement.on("keyup", (event) => {
                markText(false); // mark errors (except for end punctuation)

                clearTimeout(typingTimerID);
                if(textboxElement.val()) {
                    typingTimerID = setTimeout(saveFile, typingTimeout);
                }
            });

            // update scroll position 
            textboxElement.on("scroll", () => {
                const scrollLeft = textboxElement.scrollLeft();
                highlightsTextElement.parent().scrollLeft(scrollLeft);
            });

            // create error symbol element
            let errorSymbol;
            if(errors.length > 0) {
                errorSymbol = $(`<svg class="col-1 icon alert-danger px-1 ms-2 my-auto"><use xlink:href="#exclamation-triangle-fill"/></svg>`);
                createErrorTooltip(errorSymbol, errors);
                totalErroredClips++;
            }
            
            // add elements to list
            ul.append(
                $(`<li class="list-group-item d-flex flex-column justify-content-between align-items-start">`)
                .append([
                    title,
                    $(`<div class="row w-100">`).append([
                        errorSymbol || $(`<span style="margin-left: 0.66rem; width: 3rem;">`), // create spacer if error doesn't exist TODO: actually do this with css like a sane person
                        audioElement,
                        $(`<div class="col py-2 my-auto position-relative">`).append([
                            $(`<div class="backdrop">`).append(
                                highlightsTextElement
                            ),
                            textboxElement,
                        ])
                    ])
                ])
            );

            // add any existing text to textbox
            if(data.savedText) {
                textboxElement.val(data.savedText);
                markText();
                totalTranscribedClips++;
            }
            
        }

        averageAudioDuration = totalAudioDuration/totalClips;
        percentageTranscribedClips = (totalTranscribedClips/totalClips) * 100;

        // update counters
        $("#totalClips").text(totalClips);
        $("#totalDuration").text(toHHMMSS(totalAudioDuration));
        $("#averageDuration").text(averageAudioDuration.toFixed(1));
        $("#minDuration").text(minAudioDuration.toFixed(1));
        $("#maxDuration").text(maxAudioDuration.toFixed(1));
        $("#erroredClips").text(totalErroredClips);
        $("#totalTranscribed").text(totalTranscribedClips);
        $("#percentageTranscribed").text(percentageTranscribedClips.toFixed(1));

        // bin each audio clip based on it's length
        const audioLengthCountMap = resultArray
            .filter(el => el.status == "fulfilled") // don't include errored audio files
            .map(element => Math.round(element.value.duration)) // round all floats to the nearest integer
            .reduce((countMap, element) => countMap.set(element, (countMap.get(element) || 0) + 1), new Map()); // count the number of elements, and store it as a <element,count> map
        
        // convenience variables
        const [audioLengthBins, audioLengthBinValues] = [...audioLengthCountMap] // convert map to array of key-value tuples 
            .sort((a,b) => parseInt(a[0]) - parseInt(b[0])) // sort numerically instead of alphabetically
            .reduce((containerArr, tuple) => {containerArr.forEach((arr, i) => {arr.push(tuple[i])}); return containerArr}, [[],[]]); // reshape [[key, value]*n] tuple array to [[key]*n, [value]*n] 2D array. not pretty but that's ES6 for ya.


        // create audio count bar chart
        Chart.defaults.color = "rgb(240, 240, 240)";

        const chart = new Chart(
            $("#audio-chart"),
            {
                type: "bar",
                data: {
                    labels: audioLengthBins.map(el => `${el}s`),
                    datasets: [{
                        label: "Count",
                        data: audioLengthBinValues
                    }]
                },
                options: {
                    datasets: {
                        bar: {
                            backgroundColor: "rgba(245, 245, 245, 0.8)",
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            }
        );
        
        // unhide main container element
        $("#transcription-container").show();
    }
});

// export button opens export modal
$("#export").on("click", () => {
    // find all the audio clips that have transcriptions
    let transcribedClips = [];
    $(".highlight-text").each(function() {
        const text = $(this).val();
        if(text)
            transcribedClips.push($(this).data("audioname"));
    });

    ipcRenderer.send("export", transcribedClips);
});

// error from exporting
ipcRenderer.on("exportError", (event, data) => {
    $("#fixed-bottom-container").append(
        $(`<div class="alert alert-danger alert-dismissible fade show" role="alert">
            Export Error: ${data.error}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>`)
    );
});

// export success
ipcRenderer.on("exportSuccess", (event, data) => {
    const modalElement = $("#export-modal")[0];
    const exportModal = new bootstrap.Modal(modalElement);
    
    $("#export-output-path").text(data.outputPath);
    exportModal.show();
});