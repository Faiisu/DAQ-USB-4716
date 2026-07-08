#!.\.venv\Scripts\activate; python
# -*- coding:utf-8 -*-
import sys, os
from collections import deque

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__),
                                             os.path.pardir)))

import matplotlib
matplotlib.use("TkAgg") 
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

from Automation.BDaq import *
from Automation.BDaq.WaveformAiCtrl import WaveformAiCtrl
from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed

# ---------------- Configure ก่อนรัน ----------------
deviceDescription = 'USB-4716,BID#0'
profilePath = u"./profile.xml"

startChannel = 0
channelCount = 1
sectionLength = 500
sectionCount = 0

USER_BUFFER_SIZE = channelCount * sectionLength

# กราฟจะโชว์ข้อมูลย้อนหลังกี่ sample ต่อ channel
PLOT_WINDOW = 2000
# -----------------------------------------------------

wfAiCtrl = None
# rolling buffer สำหรับแต่ละ channel
buffers = [deque(maxlen=PLOT_WINDOW) for _ in range(channelCount)]
sample_counter = 0


def setup_device():
    global wfAiCtrl
    wfAiCtrl = WaveformAiCtrl(deviceDescription)
    wfAiCtrl.loadProfile = profilePath

    wfAiCtrl.conversion.channelStart = startChannel
    wfAiCtrl.conversion.channelCount = channelCount
    wfAiCtrl.conversion.clockRate = 1000

    wfAiCtrl.record.sectionCount = sectionCount
    wfAiCtrl.record.sectionLength = sectionLength

    for i in range(channelCount):
        wfAiCtrl.channels[startChannel + i].signalType = AiSignalType.SingleEnded
        wfAiCtrl.channels[startChannel + i].valueRange = ValueRange.V_0To5

    ret = wfAiCtrl.prepare()
    if BioFailed(ret):
        return ret
    ret = wfAiCtrl.start()
    return ret


def poll_and_update(frame, lines, ax):
    global sample_counter

    result = wfAiCtrl.getDataF64(USER_BUFFER_SIZE, -1)
    ret, returnedCount, data = result[0], result[1], result[2]

    if BioFailed(ret):
        print("Error while polling data, stopping...")
        plt.close('all')
        return lines

    if returnedCount <= 0:
        return lines

    # data เป็น interleaved array: ch0_s0, ch1_s0, ..., ch0_s1, ch1_s1, ...
    samplesPerChannel = returnedCount // channelCount
    for s in range(samplesPerChannel):
        for ch in range(channelCount):
            buffers[ch].append(data[s * channelCount + ch])

    sample_counter += samplesPerChannel

    for ch in range(channelCount):
        ydata = list(buffers[ch])
        xdata = range(sample_counter - len(ydata), sample_counter)
        lines[ch].set_data(xdata, ydata)

    ax.set_xlim(max(0, sample_counter - PLOT_WINDOW), max(PLOT_WINDOW, sample_counter))
    ax.relim()
    ax.autoscale_view(scalex=False, scaley=False)

    return lines


def main():
    ret = setup_device()
    if BioFailed(ret):
        print("Failed to start device.")
        return

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.set_title("USB-4716 Real-time Acquisition")
    ax.set_xlabel("Sample index")
    ax.set_ylabel("Voltage (V)")
    ax.set_ylim(2.9, 3.1)  
    ax.grid(True)

    lines = []
    for ch in range(channelCount):
        (line,) = ax.plot([], [], label=f"CH{startChannel + ch}")
        lines.append(line)
    ax.legend(loc="upper right")

    ani = FuncAnimation(
        fig, poll_and_update, fargs=(lines, ax),
        interval=50, blit=False, cache_frame_data=False
    )

    try:
        plt.show()
    finally:
        # หยุดและปล่อยทรัพยากรเมื่อปิดหน้าต่างกราฟ หรือเกิด error
        ret = wfAiCtrl.stop()
        wfAiCtrl.release()
        wfAiCtrl.dispose()
        if BioFailed(ret):
            enumStr = AdxEnumToString("ErrorCode", ret.value, 256)
            print("Some error occurred. Last error code: %#x [%s]" %
                  (ret.value, enumStr))


if __name__ == '__main__':
    main()