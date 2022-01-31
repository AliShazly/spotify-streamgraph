import { AppState, TrackData } from './app';

export function initDropArea(state: AppState) {
    const dropArea = document.getElementById('drop-area');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        dropArea.addEventListener(eventName, (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
    });
    ['dragenter', 'dragover'].forEach((eventName) => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight'));
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight'));
    });
    dropArea.addEventListener('drop', (e: DragEvent) => {
        if (e.dataTransfer != null) {
            [...e.dataTransfer.items].forEach((item) => {
                const entry = item.webkitGetAsEntry();
                if (entry.isDirectory) {
                    (entry as FileSystemDirectoryEntry).createReader().readEntries((entries) => {
                        entries
                            .filter((dirEntry) => filenameIsValid(dirEntry.name))
                            .forEach((dirEntry) => {
                                (dirEntry as FileSystemFileEntry).file((f) =>
                                    readToString(f, state, (str) =>
                                        rawJsonAsTrackData(str).forEach((track) => state.allTracks.add(track))
                                    )
                                );
                            });
                    });
                } else if (entry.isFile) {
                    if (filenameIsValid(entry.name)) {
                        (entry as FileSystemFileEntry).file((f) => {
                            readToString(f, state, (str) =>
                                rawJsonAsTrackData(str).forEach((track) => state.allTracks.add(track))
                            );
                        });
                    }
                }
            });
        }
    });

    const dropInput = document.getElementById('drop-input');
    dropArea.addEventListener('click', () => dropInput.click());
    dropInput.addEventListener('change', (e: Event) => {
        const files: FileList | null = (<HTMLInputElement>e.target).files;
        if (files != null) {
            [...files].forEach((f) =>
                readToString(f, state, (str) => rawJsonAsTrackData(str).forEach((track) => state.allTracks.add(track)))
            );
        }
    });
}

function filenameIsValid(filename: string): boolean {
    return filename.match(/^endsong_\d+\.json$/) != null || filename.match(/^StreamingHistory\d+\.json$/) != null;
}

function readToString(file: File, state: AppState, onloadend: (a: string) => void) {
    const reader = new FileReader();
    state.readCount++;
    reader.onloadend = () => {
        onloadend(reader.result as string);
        state.readCount--;
    };
    reader.readAsText(file);
}

function rawJsonAsTrackData(jsonAsString: string): TrackData[] {
    const parsed = JSON.parse(jsonAsString);

    const out: TrackData[] = [];
    parsed.forEach((elem) => {
        // extended streaming history (endsong_N.json)
        if (elem.ts) {
            out.push({
                timestamp: Date.parse(elem.ts),
                msPlayed: elem.ms_played,
                trackName: elem.master_metadata_track_name,
                artistName: elem.master_metadata_album_artist_name,
                albumName: elem.master_metadata_album_album_name
            });
        }
        // normal streaming history (StreamingHistoryN.json)
        else if (elem.endTime) {
            out.push({
                timestamp: Date.parse(elem.endTime),
                msPlayed: elem.msPlayed,
                trackName: elem.trackName,
                artistName: elem.artistName
            });
        }
    });
    return out;
}
