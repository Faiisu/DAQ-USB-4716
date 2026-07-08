#!.venv/Scripts/activate; python
# -*- coding:utf-8 -*-
import sys, os
import csv

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__),
                                             os.path.pardir)))
from CommonUtils import kbhit

from Automation.BDaq import *
from Automation.BDaq.WaveformAiCtrl import WaveformAiCtrl
from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed

# Configure the following parameters before running the demo
deviceDescription = 'USB-4716,BID#0'
profilePath = u"./profile.xml"

startChannel = 0
channelCount = 1
sectionLength = 10
sectionCount = 0

CSV_FILENAME = "daq_data_log.csv"


def OnBurnoutEvent(sender, args, userParam):
    status  = cast(args, POINTER(BfdAiEventArgs))[0]
    channel = status.Offset
    print("AI Channel%d is burntout!" % (channel))

# user buffer size should be equal or greater than raw data buffer length...
USER_BUFFER_SIZE = channelCount * sectionLength

def save_buffer_to_csv(filename, data, returned_count, channel_count):
    with open(filename, mode='w', newline='') as file:
        writer = csv.writer(file)
        
        for col in range(returned_count // channel_count):
            row = []
            for ch in range(channel_count):
                row.append(data[(col * channel_count)] + ch)
            writer.writerow(row)
# ============================================================================

def AdvPollingStreamingAI():
    ret = ErrorCode.Success
    
    with open(CSV_FILENAME, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow([f"Channel_{startChannel + i}" for i in range(channelCount)])

    # Step 1: Create a 'WaveformAiCtrl' for Buffered AI function
    wfAiCtrl = WaveformAiCtrl(deviceDescription)

    for _ in range(1):
        # Loads a profile to initialize the device
        wfAiCtrl.loadProfile = profilePath
        
        # Step 2: Set necessary parameters for Streaming AI operation
        wfAiCtrl.conversion.channelStart = startChannel
        wfAiCtrl.conversion.channelCount = channelCount
        wfAiCtrl.conversion.clockRate    = 1000

        # get the record instance and set record count and section length
        wfAiCtrl.record.sectionCount = sectionCount  
        wfAiCtrl.record.sectionLength = sectionLength

        for i in range(channelCount):
            wfAiCtrl.channels[startChannel + i].signalType      = AiSignalType.SingleEnded
            wfAiCtrl.channels[startChannel + i].valueRange      = ValueRange.V_0To5

        # Step 3: The operation has been started
        ret = wfAiCtrl.prepare()
        if BioFailed(ret):
            break

        ret = wfAiCtrl.start()
        if BioFailed(ret):
            break

        # Step 4: The device is acquisition data with Polling Style
        print("Polling infinite acquisition is in progress, any key to quit!")
        while not kbhit():
            result = wfAiCtrl.getDataF64(USER_BUFFER_SIZE, -1)
            ret, returnedCount, data = result[0], result[1], result[2]
            if BioFailed(ret):
                break
            
            if returnedCount > 0:
                save_buffer_to_csv(CSV_FILENAME, data, returnedCount, channelCount)

            print("Polling Stream AI get data count is %d" % returnedCount)

            print("the first sample for each channel are:")
            for i in range(channelCount):
                print("channel %d: %10.6f" % (i + startChannel, data[i]))

        # Step 6: Stop the operation if it is running
        ret = wfAiCtrl.stop()

        # Step 7: Release any allocated resource
        wfAiCtrl.release()

    # Step 9: Close device, release any allocated resource
    wfAiCtrl.dispose()

    # If something wrong in this execution...
    if BioFailed(ret):
        enumStr = AdxEnumToString("ErrorCode", ret.value, 256)
        print("Some error occurred. And the last error code is %#x. [%s]" %
              (ret.value, enumStr))
    return 0


if __name__ == '__main__':
    AdvPollingStreamingAI()