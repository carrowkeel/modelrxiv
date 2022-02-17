import json
import sys
import importlib

def run_params(script, fixed_params, variable_params):
	step_module = importlib.import_module(script.replace('.py', ''))
	result = [step_module.run({**fixed_params, **params}) for params in variable_params]
	return result

def test(script):
	try:
		step_module = importlib.import_module(script.replace('.py', ''))
		params = step_module.defaults()
		return {'input_params': params, 'dynamics_params': step_module.step(step_module.defaults(), False, 0) if step_module.step else {}, 'result_params': step_module.run(step_module.defaults())}
	except Exception as e:
		print(e, file=sys.stderr)
		return {'error': e}

def process_job(request):
	if 'test' in request['fixed_params']:
		return test(request['script'])
	else:
		return run_params(request['script'], request['fixed_params'], request['variable_params'])

def main():
	for line in sys.stdin:
		message = json.loads(line)
		if message['type'] != 'job':
			continue
		result = process_job(message['request'])
		sys.stdout.write(json.dumps({'type': 'result', 'result': result})+'\n')
		sys.stdout.flush()

main()
