import { AppState } from './app';
import * as d3 from 'd3';
import * as d3areaLabel from 'd3-area-label';

const wasmRenderContext = await import('../pkg');

const WIDTH = 1500;
const HEIGHT = 500;
const SELECTION_STROKE_W = 1.5;
const OVERLAY_LINE_W = 2;

interface ScoresAtTime {
    scores: {
        [key: string]: number;
    };
    timestamp: number;
}

interface RawDataPoint {
    key: string;
    score: number;
    timestamp: number;
}

interface PopularityOverTime {
    scores: ScoresAtTime[];
    keys: string[];
}

function popularityOverTime(tracks: RawDataPoint[], timeStepMs: number): PopularityOverTime {
    if (tracks.length == 0) {
        return {
            scores: [],
            keys: []
        };
    }

    const sortedTracks = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    const allKeys = [...new Set(sortedTracks.map((track) => track.key))];

    let lastIdx = 0;
    let currentTime = sortedTracks[0].timestamp;
    const endTime = sortedTracks[sortedTracks.length - 1].timestamp;
    const scores: ScoresAtTime[] = [];
    while (currentTime <= endTime) {
        const chunkScores: ScoresAtTime = {
            scores: Object.fromEntries(allKeys.map((i) => [i, 0])),
            timestamp: sortedTracks[lastIdx].timestamp
        };

        for (const [idx, track] of sortedTracks.slice(lastIdx, undefined).entries()) {
            if (track.timestamp >= currentTime && track.timestamp <= currentTime + timeStepMs) {
                chunkScores.scores[track.key] += track.score;
            } else {
                lastIdx += idx;
                scores.push(chunkScores);
                break;
            }
        }
        currentTime += timeStepMs;
    }
    return {
        scores: scores,
        keys: allKeys
    };
}

function color2hex(color: number[]): string {
    return (
        '#' +
        color
            .map((subpx) => {
                const base16 = Math.floor(subpx).toString(16);
                return base16.length == 1 ? '0' + base16 : base16;
            })
            .join('')
    );
}

function randColor(): string {
    // return color2hex([...Array(3)].map(() => Math.random() * 255));
    return '#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substring(1, 7);
}

function clamp(val: number, min: number, max: number): number {
    return Math.min(Math.max(val, min), max);
}

function lerp(a: number, b: number, t: number): number {
    return (1 - t) * a + t * b;
}

export function drawGraph(state: AppState) {
    if (state.readCount != 0) {
        alert('Reading files');
        return;
    }

    // if both extended and regular track data are uploaded, use the one with more entries
    const rawData: RawDataPoint[] = (
        state.allExtTracks.length > state.allTracks.length ? state.allExtTracks : state.allTracks
    )
        .map((d) => ({
            key: d.artistName,
            score: d.msPlayed,
            timestamp: d.timestamp
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    const popularity = popularityOverTime(rawData, 2629800000);

    // formatted like https://github.com/d3/d3-shape#stack
    // interface {
    //     [key: string]: number;
    //     __timestamp: number;
    // }
    const data = popularity.scores.map((scores: ScoresAtTime) => {
        const dataPoint = scores.scores;
        dataPoint.__timestamp = scores.timestamp;
        return dataPoint;
    });
    const keys = popularity.keys;

    console.log(keys, data);

    // TODO: margin: https://bl.ocks.org/mbostock/3019563

    const canvas = d3
        .select('#d3')
        .append('canvas')
        .attr('id', 'canvas')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    // const context = canvas.node().getContext('2d');
    const offscreenCanvas = d3
        .select('#d3')
        .append('canvas')
        .style('display', 'none')
        .attr('id', 'offscreenCanvas')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    const offscreenContext = offscreenCanvas.node().getContext('2d');
    const colorIdToKeyMap: Map<string, string> = new Map();
    const keyToColorIdMap: Map<string, string> = new Map();
    keys.forEach((key) => {
        let color: string = randColor();
        while (colorIdToKeyMap.has(color)) {
            color = randColor();
        }
        keyToColorIdMap.set(key, color);
        colorIdToKeyMap.set(color, key);
    });

    wasmRenderContext.webgl_init();
    console.log('Initialized webgl rendering context');

    const stack = d3.stack().offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut).keys(keys);
    const stackedData = stack(data);
    const dataLookup = new Map();
    stackedData.forEach((datum) => {
        dataLookup.set(datum.key, datum);
    });

    const overlay = d3
        .select('#d3')
        .append('svg')
        .attr('id', 'overlay')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    const selectionGroup = overlay.append('g').attr('id', 'selection');

    const x = d3
        .scaleTime()
        .domain(d3.extent(data, (d) => new Date(d.__timestamp)))
        .range([0, WIDTH]);
    const xAxis = d3.axisBottom(x).ticks(d3.timeYear.every(1));

    const y = d3
        .scaleLinear()
        .domain([
            d3.min(stackedData, (series) => d3.min(series, (d) => d[0])),
            d3.max(stackedData, (series) => d3.max(series, (d) => d[1]))
        ])
        .range([HEIGHT, 0]);

    const firstListenedColor = (key: string) => {
        const lowestTs = rawData[0].timestamp;
        const highestTs = rawData[rawData.length - 1].timestamp;
        const firstListenedTs = rawData.find((datum) => datum.key == key).timestamp;
        const normTs = (firstListenedTs - lowestTs) / (highestTs - lowestTs);
        // return d3.interpolateRdYlGn(normTs);
        return d3.interpolateRainbow(normTs);
        // return d3.interpolateTurbo(normTs);
        // return d3.interpolateCool(normTs);
    };
    const color = d3
        .scaleOrdinal()
        .domain(keys)
        .range(keys.map((k) => firstListenedColor(k)));

    const area = d3
        .area()
        .x((d: any) => x(d.data.__timestamp))
        .y0((d) => y(d[0]))
        .y1((d) => y(d[1]))
        .curve(d3.curveBasis);
    const bottomLine = d3
        .line()
        .x((d: any) => x(d.data.__timestamp))
        .y((d) => y(d[0]))
        .curve(d3.curveBasis);
    const topLine = d3
        .line()
        .x((d: any) => x(d.data.__timestamp))
        .y((d) => y(d[1]))
        .curve(d3.curveBasis);

    // https://bocoup.com/blog/d3js-and-canvas
    const detachedContainer = document.createElement('custom');
    const dataContainer = d3.select(detachedContainer);
    const dataBinding = dataContainer
        .selectAll('custom.node')
        .data(stackedData)
        .enter()
        .append('custom')
        .classed('node', true)
        .attr('fill', (d) => String(color(d.key)));

    console.log('starting triangulate...');
    const t0 = performance.now();
    dataBinding.each(function (d: any) {
        const node = d3.select(this);
        const top: string = topLine.context(null)(d);
        const bot: string = bottomLine.context(null)(d);
        const color = node.attr('fill');
        wasmRenderContext.add_area(top, bot, color);
    });
    const t1 = performance.now();
    console.log(`Triangulate took ${t1 - t0} milliseconds.`);

    console.log('drawing............. :o');
    const t00 = performance.now();
    wasmRenderContext.draw();
    const t11 = performance.now();
    console.log(`draw took ${t11 - t00} milliseconds.`);

    const drawCanvas = () => {
        //FIXME:
        // dataBinding.each(function (d: any) {
        // const node = d3.select(this);
        // context.beginPath();
        // area.context(context)(<any>d);
        // context.fillStyle = node.attr('fill');
        // context.fill();
        // });
    };
    const drawOffscreenCanvas = () => {
        dataBinding.each(function (d: any) {
            offscreenContext.beginPath();
            area.context(offscreenContext)(<any>d);
            offscreenContext.fillStyle = keyToColorIdMap.get(d.key);
            offscreenContext.fill();
        });
    };

    const mouseOverLine = overlay
        .append('rect')
        .attr('id', 'mouseOverLine')
        .attr('visibility', 'hidden')
        .attr('height', HEIGHT)
        .attr('width', OVERLAY_LINE_W)
        .attr('mask', 'url(#lineMask)');
    const lineMask = overlay.append('mask').attr('id', 'lineMask');

    const labelsGrp = overlay.append('g').attr('id', 'labels');

    const zoomRect = overlay.append('rect').attr('id', 'zoomRect').attr('visibility', 'hidden');

    const tooltip = overlay
        .append('text')
        .attr('id', 'tooltip')
        .attr('x', 50)
        .attr('y', 50)
        .attr('visibility', 'hidden');

    const gX = overlay
        .append('g')
        .attr('id', 'xAxis')
        .attr('transform', `translate(0,${HEIGHT - 25})`)
        .call(xAxis);

    const zoomCanvas = (
        context: CanvasRenderingContext2D,
        transform: d3.ZoomTransform,
        drawFn: () => void
    ) => {
        context.clearRect(0, 0, WIDTH, HEIGHT);
        context.save();
        context.translate(transform.x, transform.y);
        context.scale(transform.k, transform.k);
        drawFn();
        context.restore();
    };

    const zoom = d3
        .zoom()
        .scaleExtent([1, 10])
        .translateExtent([
            [0, 0],
            [WIDTH, HEIGHT]
        ])
        .on('start', () => {
            d3.selectAll('.areaLabel').remove();
        })
        .filter(() => false) // no auto zoom / pan
        .on('zoom', ({ transform }) => {
            gX.call(xAxis.scale(transform.rescaleX(x)));
            // zoomCanvas(context, transform, drawCanvas); //FIXME:
            d3.selectAll('.selectedArea')
                .attr('transform', transform)
                .attr('stroke-width', SELECTION_STROKE_W / transform.k);
            mouseOverLine.attr('width', OVERLAY_LINE_W * transform.k);
        })
        .on('end', ({ transform }) => {
            zoomCanvas(offscreenContext, transform, drawOffscreenCanvas);

            // draw labels: FIXME:
            // setTimeout(() => {
            //     const tx = transform.invertX(0);
            //     const tw = transform.invertX(WIDTH);
            //     const ty = transform.invertY(0);
            //     const th = transform.invertY(HEIGHT);
            //     const zoomArea = d3
            //         .area()
            //         .x((d: any) => transform.applyX(clamp(x(d.data.__timestamp), tx, tw)))
            //         .y0((d) => transform.applyY(clamp(y(d[0]), ty, th)))
            //         .y1((d) => transform.applyY(clamp(y(d[1]), ty, th)));
            //     // .curve(d3.curveBasis);
            //     // only computing area labels for onscreen data
            //     const imgData = offscreenContext.getImageData(0, 0, WIDTH, HEIGHT).data;
            //     const onscreenKeys: Set<string> = new Set();
            //     for (let i = 0; i < imgData.length; i += 4) {
            //         const lookupColor = color2hex([...imgData.slice(i, i + 3)]);
            //         const keyFromColor = colorIdToKeyMap.get(lookupColor);
            //         onscreenKeys.add(keyFromColor);
            //     }
            //     const onscreenData = [...onscreenKeys]
            //         .filter((k) => k != undefined)
            //         .map((k) => dataLookup.get(k));

            //     const res = onscreenData.length < 50 ? 2000 : 100;

            //     labelsGrp
            //         .selectAll('text')
            //         .data(onscreenData)
            //         .enter()
            //         .append('text')
            //         .classed('areaLabel', true)
            //         .text((d) => d.key)
            //         .attr(
            //             'transform',
            //             d3areaLabel
            //                 .areaLabel(zoomArea)
            //                 .interpolateResolution(res)
            //                 .minHeight(2 * transform.k)
            //         );
            // }, 0);
        });

    canvas.call(<any>zoom.transform, d3.zoomIdentity);

    let selectedKey: string | null = null;
    let [zoomRectInitX, zoomRectInitY] = [0, 0];
    overlay
        .on('mousedown', (ev) => {
            [zoomRectInitX, zoomRectInitY] = d3.pointer(ev, overlay.node());
            zoomRect
                .attr('visibility', 'visible')
                .attr('x', zoomRectInitX)
                .attr('y', zoomRectInitY)
                .attr('width', 0)
                .attr('height', 0);
        })
        .on('mousemove', (ev) => {
            if (selectedKey != null) {
                const curTransform = d3.zoomTransform(canvas.node() as Element);
                const mouseX = d3.pointer(ev, overlay.node())[0];
                const zoomedX = curTransform.invertX(mouseX);
                const fltIdx = (zoomedX / WIDTH) * (data.length - 1);
                if (fltIdx >= 0 && fltIdx <= data.length - 1) {
                    const minsListened = Math.round(
                        lerp(
                            data[Math.floor(fltIdx)][selectedKey],
                            data[Math.ceil(fltIdx)][selectedKey],
                            fltIdx - Math.floor(fltIdx)
                        ) / 60_000
                    );
                    // TODO: display in hrs/mins/secs
                    tooltip.text(`${selectedKey} : ${minsListened}`);
                }
                mouseOverLine.attr('x', mouseX - +mouseOverLine.attr('width') / 2);
            }
            if (ev.buttons > 0) {
                const [mouseX, mouseY] = d3.pointer(ev, overlay.node());
                zoomRect
                    .attr('x', Math.min(zoomRectInitX, mouseX))
                    .attr('y', Math.min(zoomRectInitY, mouseY))
                    .attr('width', Math.abs(zoomRectInitX - mouseX))
                    .attr('height', Math.abs(zoomRectInitY - mouseY));
            }
        })
        .on('mouseup', (ev) => {
            zoomRect.attr('visibility', 'hidden');
            const [mouseX, mouseY] = d3.pointer(ev, overlay.node());
            const curTransform = d3.zoomTransform(canvas.node() as Element);
            const [zoomX, zoomY, zoomWidth, zoomHeight] = [
                +zoomRect.attr('x'),
                +zoomRect.attr('y'),
                +zoomRect.attr('width'),
                +zoomRect.attr('height')
            ];

            // on a click
            if (zoomWidth == 0 || zoomHeight == 0) {
                canvas.style('opacity', 1);
                tooltip.attr('visibility', 'hidden');
                mouseOverLine.attr('visibility', 'hidden');
                d3.selectAll('.selectedArea').remove();

                const offscreenColor = offscreenContext.getImageData(mouseX, mouseY, 1, 1).data;
                const lookupColor = color2hex([...offscreenColor.slice(0, 3)]);
                const keyFromColor = colorIdToKeyMap.get(lookupColor);
                if (keyFromColor == selectedKey || keyFromColor == undefined) {
                    selectedKey = null;
                } else {
                    selectedKey = keyFromColor;
                    canvas.style('opacity', 0.5);
                    tooltip.attr('visibility', 'visible');
                    tooltip.text(selectedKey);
                    mouseOverLine.attr('visibility', 'visible');
                    mouseOverLine.attr('x', mouseX - +mouseOverLine.attr('width') / 2);
                    const datum = dataLookup.get(selectedKey);
                    selectionGroup
                        .append('path')
                        .data([datum])
                        .classed('selectedArea', true)
                        .style('fill', (d) => String(color(d.key)))
                        .attr('d', area.context(null))
                        .attr('stroke-width', SELECTION_STROKE_W / curTransform.k)
                        .attr('transform', <any>curTransform);
                    lineMask
                        .append('path')
                        .data([datum])
                        .classed('selectedArea', true)
                        .attr('fill', 'white')
                        .attr('stroke', 'black')
                        .attr('d', area.context(null))
                        .attr('stroke-width', SELECTION_STROKE_W / curTransform.k)
                        .attr('transform', <any>curTransform);
                }
                return;
            }

            // if we're already zoomed in, reset zoom
            if (curTransform.x != 0 || curTransform.y != 0 || curTransform.k != 1) {
                canvas
                    .transition()
                    .duration(1000)
                    .call(<any>zoom.transform, d3.zoomIdentity);
            }
            // else, perform zoom
            else {
                // TODO: impl zooming when already zoomed in, based on curTransform
                const scale = 1 / Math.min(zoomWidth / WIDTH, zoomHeight / HEIGHT);
                const [svgCenterX, svgCenterY] = [WIDTH / 2, HEIGHT / 2];
                const [zoomCenterX, zoomCenterY] = [zoomX + zoomWidth / 2, zoomY + zoomHeight / 2];
                const [relX, relY] = [svgCenterX - zoomCenterX, svgCenterY - zoomCenterY];
                const transform = d3.zoomIdentity
                    //https://stackoverflow.com/questions/43184515/d3-js-v4-zoom-to-chart-center-not-mouse-position
                    .translate(
                        svgCenterX - (2 * svgCenterX * scale) / 2,
                        svgCenterY - (2 * svgCenterY * scale) / 2
                    )
                    .scale(scale)
                    .translate(relX, relY);
                canvas
                    .transition()
                    .duration(1000)
                    .call(<any>zoom.transform, transform)
                    .on('end', () => {
                        //TODO: force redraw of svg
                    });
            }
        })
        .on('mouseout', () => tooltip.text(selectedKey));
}
