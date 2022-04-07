import { TrackData } from './app';

enum FileType {
    Extended,
    Regular,
    Invalid
}

interface Counter {
    count: number;
}

export function initDropArea(
    onUploadEnd: (allTracks: TrackData[], allExtTracks: TrackData[]) => void
) {
    const allTracks: TrackData[] = [];
    const allExtTracks: TrackData[] = [];
    const readCount: Counter = { count: 0 };

    const dropArea = document.getElementById('drop-area');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        dropArea.addEventListener(eventName, (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
    });
    ['dragenter', 'dragover'].forEach((eventName) => {
        dropArea.addEventListener(eventName, () =>
            dropArea.classList.add('highlight')
        );
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        dropArea.addEventListener(eventName, () =>
            dropArea.classList.remove('highlight')
        );
    });
    dropArea.addEventListener('drop', (e: DragEvent) => {
        if (e.dataTransfer != null) {
            [...e.dataTransfer.items].forEach((item) => {
                const entry = item.webkitGetAsEntry();
                if (entry.isDirectory) {
                    (entry as FileSystemDirectoryEntry)
                        .createReader()
                        .readEntries((entries) => {
                            entries.forEach((dirEntry) => {
                                (dirEntry as FileSystemFileEntry).file((f) =>
                                    ingestFile(
                                        f,
                                        allTracks,
                                        allExtTracks,
                                        readCount,
                                        onUploadEnd
                                    )
                                );
                            });
                        });
                } else if (entry.isFile) {
                    (entry as FileSystemFileEntry).file((f) =>
                        ingestFile(
                            f,
                            allTracks,
                            allExtTracks,
                            readCount,
                            onUploadEnd
                        )
                    );
                }
            });
        }
    });

    const dropInput = document.getElementById('drop-input');
    dropArea.addEventListener('click', () => dropInput.click());
    dropInput.addEventListener('change', (e: Event) => {
        const files: FileList | null = (<HTMLInputElement>e.target).files;
        if (files != null) {
            [...files].forEach((f) => {
                ingestFile(f, allTracks, allExtTracks, readCount, onUploadEnd);
            });
        }
    });
}

// TODO: maybe validate content instead of relying on filename
function checkFilename(filename: string): FileType {
    if (filename.match(/^endsong_\d+\.json$/) != null) {
        return FileType.Extended;
    } else if (filename.match(/^StreamingHistory\d+\.json$/) != null) {
        return FileType.Regular;
    }
    return FileType.Invalid;
}

function ingestFile(
    file: File,
    allTracks: TrackData[],
    allExtTracks: TrackData[],
    readCount: Counter,
    onUploadFinish: (allTracks: TrackData[], allExtTracks: TrackData[]) => void
) {
    let isExtended: boolean;
    switch (checkFilename(file.name)) {
        case FileType.Extended: {
            isExtended = true;
            break;
        }
        case FileType.Regular: {
            isExtended = false;
            break;
        }
        case FileType.Invalid:
            return;
    }
    const tracks = isExtended ? allExtTracks : allTracks;
    const parseFn = isExtended ? parseExtTrackData : parseTrackData;
    const reader = new FileReader();
    readCount.count++;
    reader.onloadend = () => {
        parseFn(reader.result as string)
            .filter((track) => track.msPlayed > 0 && track.timestamp > 0)
            .forEach((track) => {
                tracks.push(track);
            });
        readCount.count--;
        if (readCount.count == 0) {
            onUploadFinish(allTracks, allExtTracks);
        }
    };
    reader.readAsText(file);
}

// normal streaming history (StreamingHistoryN.json)
function parseTrackData(rawJson: string): TrackData[] {
    const parsed = JSON.parse(rawJson);

    const out: TrackData[] = [];
    parsed.forEach((elem) => {
        if (
            elem.endTime != null &&
            elem.msPlayed != null &&
            elem.trackName != null &&
            elem.artistName != null
        ) {
            out.push({
                timestamp: Date.parse(elem.endTime) - elem.msPlayed,
                msPlayed: elem.msPlayed,
                trackName: elem.trackName,
                artistName: elem.artistName
            });
        }
    });
    return out;
}

// extended streaming history (endsong_N.json)
function parseExtTrackData(rawJson: string): TrackData[] {
    const parsed = JSON.parse(rawJson);

    const out: TrackData[] = [];
    parsed.forEach((elem) => {
        if (
            elem.ts != null &&
            elem.ms_played != null &&
            elem.master_metadata_album_album_name != null &&
            elem.master_metadata_album_artist_name != null &&
            elem.master_metadata_track_name != null
        ) {
            out.push({
                timestamp: Date.parse(elem.ts) - elem.ms_played,
                msPlayed: elem.ms_played,
                trackName: elem.master_metadata_track_name,
                artistName: elem.master_metadata_album_artist_name,
                albumName: elem.master_metadata_album_album_name
            });
        }
    });
    return out;
}
