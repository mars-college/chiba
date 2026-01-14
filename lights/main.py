from homeassistant_api import Client

HA_TOKEN = os.getenv("HA_TOKEN")

HA_URL = "http://10.10.13.9:8123/api"

client = Client(HA_URL, HA_TOKEN)

# Turn on/off a switch entity
client.trigger_service("switch", "turn_off", entity_id="switch.mars02")


#client.set_state("switch.mars02", "on")
# client.set_state("switch.mars02", "off")

# # Or call the switch domain services (often cleaner)
# client.trigger_service("switch", "turn_on", entity_id="switch.mars02")
# client.trigger_service("switch", "turn_off", entity_id="switch.mars02")
# client.trigger_service("switch", "toggle", entity_id="switch.mars02")


