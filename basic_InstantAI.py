#!.venv/Scripts/activate; python
import sys, os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__),
                                             os.path.pardir)))

from CommonUtils import kbhit

import time

from Automation.BDaq import *
from Automation.BDaq.InstantAiCtrl import InstantAiCtrl
from Automation.BDaq.BDaqApi import AdxEnumToString, BioFailed

deviceDescription = "USB-4716,BID#0"
profilePath = u"./profile.xml"

channelCount = 1
startChannel = 0

def AdvInstantAI():
    ret = ErrorCode.Success

    # Step 1: Create a 'instantAiCtrl' for InstantAI function
    # Login an Edge Server by hostname for remote control
    # Select a device by device number or device description and specify the
    # access mode.
    # In this example we use ModeWrite mode so that we can fully control the
    # device,
    # including configuring, sampling, etc.
    instanceAiObj = InstantAiCtrl(deviceDescription)    
    
    for _ in range(1):
        
        # Loads a profile to initialize the device
        instanceAiObj.loadProfile = profilePath 

        # Step 2: Read samples and do post-process, we show data here.
        print("Acquisition is in progress, any key to quit!")
        while not kbhit():
            ret, scaledData = instanceAiObj.readDataF64(startChannel, channelCount)
            if BioFailed(ret):
                break
            
            for i in range(startChannel, startChannel + channelCount):
                print("Channel %d data: %10.6f" % (i, scaledData[i-startChannel]))

            time.sleep(0.1)            
    
    # Step _: Close device, release any allocated resource
    instanceAiObj.dispose()

    if BioFailed(ret):
        enumStr = AdxEnumToString("ErrorCode", ret.value, 256)
        print("Some error occurred. And the last error code is %#x. [%s]" %
              (ret.value, enumStr))
    return 0


if __name__ == '__main__':
    AdvInstantAI()
