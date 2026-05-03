notes


Anchor is an ambient agent that detects likely behavioral drift during a declared focus window using device, motion, time, and proximity signals — then delivers a low-friction decision checkpoint through smart glasses: “On purpose?”



enter on focus mode -  doing different thing ( multi taksing) - nudge on focus 
screen time data in iphone  
not a habit tracking app - creating a better habit app 
willpower  
output - tone based on the personality 
accelerometer 


Things to figure

access to the apps 
hello world on the app 



Points on the glasses

streaming text flow 
question emoijs

------------------------------------
- Drift categories
- Drift styles/ times
- 







Points
- easiest mvp piece we can build to showcase progress
with a ui dashboard like thingy

- deliverable - 2.30 to 3 
    - idea of architecture and model reasoning and prompts, data model


input sources 
- apple watch signals
- 


TODO 

- vercel deploy with db
- interface for g2 glasses input and output

- context of the information that matters to detect the drift score?


- drift window to 2 mins 








  # Clear drift — should fire checkpoint
  bash scripts/test_scenarios.sh drift                                                  
   
  # Intentional research — should stay ON TRACK                                         
  bash scripts/test_scenarios.sh research                                             
                                                                                        
  # Ambiguous (email + Slack) — watch LLM reason carefully                            
  bash scripts/test_scenarios.sh ambiguous
                                                                                        
  # Phone pickup via accelerometer only (no browser signal)
  bash scripts/test_scenarios.sh phone                                                  
                                                                                      
  # Memory layer demo — run after drift + 'switch' response                             
  bash scripts/test_scenarios.sh memory
                                                                                        
  # Mode comparison — same signals, change mode pill between runs                       
  bash scripts/test_scenarios.sh mode_demo